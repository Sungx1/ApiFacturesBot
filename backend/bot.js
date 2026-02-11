// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const generateInvoice = require('./invoiceGenerator');

class OrderBot {
  constructor(token, ownerId) {
    this.bot = new TelegramBot(token, { polling: true });
    this.ownerId = ownerId;
    this.initHandlers();
    console.log('🤖 Bot iniciado con polling');
  }

  initHandlers() {
    // Comando /start
    this.bot.onText(/\/start/, (msg) => {
      this.bot.sendMessage(msg.chat.id, 
        '👋 Bienvenido a la tienda.\n' +
        'Comandos disponibles:\n' +
        '/id - Obtener tu chat ID\n' +
        '/productos - Ver catálogo (solo dueño)\n' +
        '/addproducto - Agregar producto (solo dueño)'
      );
    });

    // Obtener ID del chat
    this.bot.onText(/\/id/, (msg) => {
      this.bot.sendMessage(msg.chat.id, `Tu chat ID es: ${msg.chat.id}`);
    });

    // Agregar producto (solo dueño)
    this.bot.onText(/\/addproducto (.+)/, async (msg, match) => {
      if (msg.chat.id != this.ownerId) {
        return this.bot.sendMessage(msg.chat.id, '❌ No autorizado');
      }

      const args = match[1].split('|').map(s => s.trim());
      if (args.length < 5) {
        return this.bot.sendMessage(msg.chat.id, 
          '⚠️ Formato incorrecto. Usa:\n/addproducto Nombre | Precio | Stock | Detalles | Envio(si/no)'
        );
      }

      const [nombre, precio, stock, detalles, envio] = args;
      const tiene_envio = envio.toLowerCase() === 'si';

      try {
        const result = await db.query(
          `INSERT INTO productos (nombre, precio, cantidad, detalles, tiene_envio) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [nombre, parseFloat(precio), parseInt(stock), detalles, tiene_envio]
        );
        this.bot.sendMessage(msg.chat.id, 
          `✅ Producto "${nombre}" agregado con ID ${result.rows[0].id}`
        );
      } catch (error) {
        console.error(error);
        this.bot.sendMessage(msg.chat.id, '❌ Error al guardar producto');
      }
    });

    // Listar productos (solo dueño)
    this.bot.onText(/\/productos/, async (msg) => {
      if (msg.chat.id != this.ownerId) return;

      try {
        const result = await db.query('SELECT * FROM productos ORDER BY id DESC');
        if (result.rows.length === 0) {
          return this.bot.sendMessage(msg.chat.id, '📭 No hay productos cargados');
        }

        let resp = '📦 *Catálogo actual:*\n\n';
        result.rows.forEach(p => {
          resp += `ID: ${p.id}\n` +
                  `📌 ${p.nombre}\n` +
                  `💰 $${p.precio}\n` +
                  `📦 Stock: ${p.cantidad}\n` +
                  `📝 ${p.detalles || 'Sin detalles'}\n` +
                  `🚚 ${p.tiene_envio ? 'Con envío' : 'Sin envío'}\n\n`;
        });
        this.bot.sendMessage(msg.chat.id, resp, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(error);
        this.bot.sendMessage(msg.chat.id, '❌ Error al obtener productos');
      }
    });

    // Callback de botones inline (aprobación/rechazo)
    this.bot.on('callback_query', async (callbackQuery) => {
      const data = callbackQuery.data;
      const message = callbackQuery.message;
      const chatId = message.chat.id;

      if (chatId != this.ownerId) {
        return this.bot.answerCallbackQuery(callbackQuery.id, { text: 'No autorizado' });
      }

      const [accion, pedidoId] = data.split('_');

      if (accion === 'aprobar') {
        await this.aprobarPedido(pedidoId, message);
      } else if (accion === 'rechazar') {
        await this.rechazarPedido(pedidoId, message);
      }

      this.bot.answerCallbackQuery(callbackQuery.id);
    });
  }

  // Enviar pedido al dueño con botones
  async enviarPedidoAlDueño(pedido) {
    let mensaje = `🛒 *Nuevo pedido #${pedido.id}*\n`;
    mensaje += `Cliente: ${pedido.cliente_nombre}\n`;
    mensaje += `Total: $${pedido.total}\n\n`;
    mensaje += `*Productos:*\n`;
    pedido.items.forEach(item => {
      mensaje += `- ${item.nombre} x${item.cantidad} = $${item.precio_unitario * item.cantidad}\n`;
    });

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprobar', callback_data: `aprobar_${pedido.id}` },
          { text: '❌ Rechazar', callback_data: `rechazar_${pedido.id}` }
        ]
      ]
    };

    await this.bot.sendMessage(this.ownerId, mensaje, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
  }

  // Aprobar pedido
  async aprobarPedido(pedidoId, msg) {
    try {
      // Actualizar estado en BD
      await db.query(
        `UPDATE pedidos SET estado = 'aprobado', fecha_aprobacion = CURRENT_TIMESTAMP WHERE id = $1`,
        [pedidoId]
      );

      // Editar mensaje original
      await this.bot.editMessageText(
        `✅ *Pedido #${pedidoId} APROBADO*`,
        {
          chat_id: this.ownerId,
          message_id: msg.message_id,
          parse_mode: 'Markdown'
        }
      );

      // Obtener pedido completo
      const pedido = await this.obtenerPedidoCompleto(pedidoId);
      
      // Generar factura
      const pdfPath = await generateInvoice(pedido);
      
      // Enviar factura al dueño
      await this.bot.sendDocument(this.ownerId, pdfPath, {}, {
        caption: `Factura del pedido #${pedidoId}`
      });

    } catch (error) {
      console.error(error);
      this.bot.sendMessage(this.ownerId, '❌ Error al aprobar pedido');
    }
  }

  // Rechazar pedido
  async rechazarPedido(pedidoId, msg) {
    try {
      await db.query(
        `UPDATE pedidos SET estado = 'rechazado' WHERE id = $1`,
        [pedidoId]
      );

      await this.bot.editMessageText(
        `❌ *Pedido #${pedidoId} RECHAZADO*`,
        {
          chat_id: this.ownerId,
          message_id: msg.message_id,
          parse_mode: 'Markdown'
        }
      );
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(this.ownerId, '❌ Error al rechazar pedido');
    }
  }

  // Obtener pedido completo con items
  async obtenerPedidoCompleto(pedidoId) {
    const pedidoRes = await db.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    if (pedidoRes.rows.length === 0) throw new Error('Pedido no encontrado');
    const pedido = pedidoRes.rows[0];

    const itemsRes = await db.query(`
      SELECT ip.*, p.nombre 
      FROM items_pedido ip
      JOIN productos p ON ip.producto_id = p.id
      WHERE ip.pedido_id = $1
    `, [pedidoId]);
    
    pedido.items = itemsRes.rows;
    return pedido;
  }
}

module.exports = OrderBot;