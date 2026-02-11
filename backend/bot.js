const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const generateInvoice = require('./invoiceGenerator');

class OrderBot {
  constructor(token, ownerId) {
    this.bot = new TelegramBot(token, { polling: true });
    this.ownerId = ownerId;
    this.userState = {}; // Para seguimiento de conversaciones
    this.adminState = {}; // Para el proceso de agregar producto paso a paso
    this.initHandlers();
  }

  // -----------------------------------------------------------------
  // INICIALIZACIÓN DE HANDLERS
  // -----------------------------------------------------------------
  initHandlers() {
    // -------------------- ADMIN: SOLO DUEÑO --------------------
    // Comando /start (para todos)
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId == this.ownerId) {
        await this.showAdminMenu(chatId);
      } else {
        await this.showMainMenu(chatId);
      }
    });

    // Manejar respuestas del admin en el flujo de agregar producto
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      if (chatId != this.ownerId) return; // Solo admin

      // Si el admin está en medio del proceso de agregar producto
      if (this.adminState[chatId]?.step) {
        await this.handleAdminProductInput(msg);
        return;
      }
    });

    // Callbacks para admin (botones inline)
    this.bot.on('callback_query', async (callbackQuery) => {
      const data = callbackQuery.data;
      const msg = callbackQuery.message;
      const chatId = msg.chat.id;

      // --- ADMIN CALLBACKS ---
      if (chatId == this.ownerId) {
        // Aprobar/Rechazar pedido
        if (data.startsWith('aprobar_') || data.startsWith('rechazar_')) {
          const [accion, pedidoId] = data.split('_');
          if (accion === 'aprobar') await this.aprobarPedido(pedidoId, msg);
          else if (accion === 'rechazar') await this.rechazarPedido(pedidoId, msg);
          this.bot.answerCallbackQuery(callbackQuery.id);
          return;
        }

        // Menú admin
        switch (data) {
          case 'admin_agregar_producto':
            await this.iniciarAgregarProducto(chatId, msg);
            break;
          case 'admin_listar_productos':
            await this.listarProductosAdmin(chatId, msg);
            break;
          case 'admin_pedidos_pendientes':
            await this.listarPedidosPendientes(chatId, msg);
            break;
          case 'admin_volver':
            await this.showAdminMenu(chatId, msg);
            break;
        }
        this.bot.answerCallbackQuery(callbackQuery.id);
        return;
      }

      // --- CLIENTE CALLBACKS ---
      const [accion, valor] = data.split('_');
      switch (accion) {
        case 'menu':
          await this.showMainMenu(chatId, msg);
          break;
        case 'catalogo':
          await this.showCatalogo(chatId, msg);
          break;
        case 'producto':
          await this.selectProduct(chatId, parseInt(valor), msg);
          break;
        case 'completar':
          await this.showResumenPedido(chatId, msg);
          break;
        case 'cancelar_pedido':
          await this.cancelarPedidoCliente(chatId, msg);
          break;
        case 'pagar':
          await this.showMetodosPago(chatId, msg);
          break;
        case 'metodo_pago':
          await this.procesarPago(chatId, valor, msg);
          break;
        case 'mis_pedidos':
          await this.showMisPedidos(chatId, msg);
          break;
      }
      this.bot.answerCallbackQuery(callbackQuery.id);
    });

    // Mensajes de clientes (no admin) que no son comandos
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      if (chatId == this.ownerId) return; // ya manejado
      if (msg.text && msg.text.startsWith('/')) return;

      // Si el cliente está en estado de esperar cantidad
      if (this.userState[chatId]?.step === 'awaiting_quantity') {
        await this.handleQuantityInput(msg);
        return;
      }

      // Si no, mostrar menú principal
      await this.showMainMenu(chatId);
    });
  }

  // -----------------------------------------------------------------
  // MÉTODOS PARA ADMIN (con botones y flujo guiado)
  // -----------------------------------------------------------------
  async showAdminMenu(chatId, msg = null) {
    const texto = '👑 *Panel de Administración*\n\nSelecciona una opción:';
    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ Agregar Producto', callback_data: 'admin_agregar_producto' }],
        [{ text: '📋 Listar Productos', callback_data: 'admin_listar_productos' }],
        [{ text: '📦 Pedidos Pendientes', callback_data: 'admin_pedidos_pendientes' }]
      ]
    };
    if (msg) {
      await this.bot.editMessageText(texto, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else {
      await this.bot.sendMessage(chatId, texto, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  }

  // Iniciar flujo de agregar producto (paso a paso)
  async iniciarAgregarProducto(chatId, msg) {
    this.adminState[chatId] = { step: 'nombre' };
    await this.bot.editMessageText('➕ *Agregar nuevo producto*\n\nPaso 1/5: Envía el **nombre** del producto:', {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown'
    });
  }

  async handleAdminProductInput(msg) {
    const chatId = msg.chat.id;
    const state = this.adminState[chatId];
    const text = msg.text;

    switch (state.step) {
      case 'nombre':
        state.nombre = text;
        state.step = 'precio';
        await this.bot.sendMessage(chatId, '✅ Nombre guardado.\n\nPaso 2/5: Envía el **precio** (ej: 12.50):');
        break;
      case 'precio':
        if (isNaN(parseFloat(text)) || parseFloat(text) <= 0) {
          return this.bot.sendMessage(chatId, '❌ Precio inválido. Debe ser un número mayor a 0.');
        }
        state.precio = parseFloat(text);
        state.step = 'cantidad';
        await this.bot.sendMessage(chatId, '✅ Precio guardado.\n\nPaso 3/5: Envía la **cantidad en stock**:');
        break;
      case 'cantidad':
        if (isNaN(parseInt(text)) || parseInt(text) < 0) {
          return this.bot.sendMessage(chatId, '❌ Cantidad inválida. Debe ser un número entero >= 0.');
        }
        state.cantidad = parseInt(text);
        state.step = 'detalles';
        await this.bot.sendMessage(chatId, '✅ Stock guardado.\n\nPaso 4/5: Envía los **detalles** del producto (o escribe "ninguno"):');
        break;
      case 'detalles':
        state.detalles = text === 'ninguno' ? '' : text;
        state.step = 'envio';
        await this.bot.sendMessage(chatId, '✅ Detalles guardados.\n\nPaso 5/5: ¿Incluye **envío**? Responde "si" o "no":');
        break;
      case 'envio':
        if (text.toLowerCase() !== 'si' && text.toLowerCase() !== 'no') {
          return this.bot.sendMessage(chatId, '❌ Responde "si" o "no".');
        }
        state.tiene_envio = text.toLowerCase() === 'si';
        // Guardar en base de datos
        try {
          const result = await db.query(
            `INSERT INTO productos (nombre, precio, cantidad, detalles, tiene_envio) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [state.nombre, state.precio, state.cantidad, state.detalles, state.tiene_envio]
          );
          await this.bot.sendMessage(chatId, 
            `✅ *Producto agregado exitosamente!*\n\nID: ${result.rows[0].id}\nNombre: ${state.nombre}\nPrecio: $${state.precio}\nStock: ${state.cantidad}\nDetalles: ${state.detalles || 'Ninguno'}\nEnvío: ${state.tiene_envio ? 'Sí' : 'No'}`, 
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error(error);
          await this.bot.sendMessage(chatId, '❌ Error al guardar el producto.');
        }
        // Limpiar estado y volver al menú admin
        delete this.adminState[chatId];
        await this.showAdminMenu(chatId);
        break;
    }
  }

  async listarProductosAdmin(chatId, msg) {
    try {
      const result = await db.query('SELECT * FROM productos ORDER BY id DESC');
      if (result.rows.length === 0) {
        await this.bot.editMessageText('📭 No hay productos cargados.', {
          chat_id: chatId,
          message_id: msg.message_id
        });
        return;
      }
      let texto = '📦 *Listado de Productos*\n\n';
      result.rows.forEach(p => {
        texto += `*ID:* ${p.id}\n`;
        texto += `*Nombre:* ${p.nombre}\n`;
        texto += `*Precio:* $${p.precio}\n`;
        texto += `*Stock:* ${p.cantidad}\n`;
        texto += `*Detalles:* ${p.detalles || 'Ninguno'}\n`;
        texto += `*Envío:* ${p.tiene_envio ? 'Sí' : 'No'}\n`;
        texto += `────────────────\n`;
      });
      const keyboard = {
        inline_keyboard: [
          [{ text: '🔙 Volver', callback_data: 'admin_volver' }]
        ]
      };
      await this.bot.editMessageText(texto, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al listar productos.');
    }
  }

  async listarPedidosPendientes(chatId, msg) {
    try {
      const result = await db.query(
        `SELECT * FROM pedidos WHERE estado = 'pendiente_aprobacion_dueño' ORDER BY fecha_pedido ASC`
      );
      if (result.rows.length === 0) {
        await this.bot.editMessageText('📭 No hay pedidos pendientes.', {
          chat_id: chatId,
          message_id: msg.message_id
        });
        return;
      }
      let texto = '⏳ *Pedidos Pendientes de Aprobación*\n\n';
      for (const pedido of result.rows) {
        texto += `*Pedido #${pedido.id}*\n`;
        texto += `Cliente: ${pedido.cliente_nombre}\n`;
        texto += `Fecha: ${new Date(pedido.fecha_pedido).toLocaleString()}\n`;
        texto += `Total: $${pedido.total}\n`;
        // Obtener items
        const itemsRes = await db.query(
          `SELECT ip.*, p.nombre FROM items_pedido ip JOIN productos p ON ip.producto_id = p.id WHERE ip.pedido_id = $1`,
          [pedido.id]
        );
        itemsRes.rows.forEach(item => {
          texto += `  - ${item.nombre} x${item.cantidad} = $${item.precio_unitario * item.cantidad}\n`;
        });
        texto += `────────────────\n`;
      }
      const keyboard = {
        inline_keyboard: [
          [{ text: '🔙 Volver', callback_data: 'admin_volver' }]
        ]
      };
      await this.bot.editMessageText(texto, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al listar pedidos.');
    }
  }

  // -----------------------------------------------------------------
  // MÉTODOS PARA CLIENTES (Telegram)
  // -----------------------------------------------------------------
  async showMainMenu(chatId, msg = null) {
    const texto = '🛍️ *Bienvenido a la Tienda Online*\n\nElige una opción:';
    const keyboard = {
      inline_keyboard: [
        [{ text: '📋 Consultar Catálogo', callback_data: 'catalogo_' }],
        [{ text: '📦 Mis Pedidos', callback_data: 'mis_pedidos_' }]
      ]
    };
    if (msg) {
      await this.bot.editMessageText(texto, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else {
      await this.bot.sendMessage(chatId, texto, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  }

  async showCatalogo(chatId, msg) {
    try {
      const result = await db.query('SELECT * FROM productos WHERE cantidad > 0 ORDER BY nombre');
      const productos = result.rows;

      if (productos.length === 0) {
        await this.bot.editMessageText('📭 No hay productos disponibles.', {
          chat_id: chatId,
          message_id: msg.message_id
        });
        return;
      }

      let inlineKeyboard = productos.map(p => ([
        { text: `${p.nombre} - $${p.precio}`, callback_data: `producto_${p.id}` }
      ]));
      
      inlineKeyboard.push([{ text: '✅ Completar pedido', callback_data: 'completar_' }]);
      inlineKeyboard.push([{ text: '🔙 Menú principal', callback_data: 'menu_' }]);

      await this.bot.editMessageText('📦 *Selecciona los productos que deseas:*\n(Al presionar un producto, escribe la cantidad)', {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al cargar catálogo.');
    }
  }

  async selectProduct(chatId, productoId, msg) {
    const result = await db.query('SELECT * FROM productos WHERE id = $1', [productoId]);
    const producto = result.rows[0];
    if (!producto) {
      return this.bot.sendMessage(chatId, '❌ Producto no encontrado.');
    }

    this.userState[chatId] = {
      step: 'awaiting_quantity',
      productoId: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      messageId: msg.message_id
    };

    await this.bot.sendMessage(chatId, 
      `🛒 *${producto.nombre}*\nPrecio: $${producto.precio}\nStock: ${producto.cantidad}\n\nEscribe la cantidad que deseas:`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleQuantityInput(msg) {
    const chatId = msg.chat.id;
    const cantidad = parseInt(msg.text);

    if (isNaN(cantidad) || cantidad <= 0) {
      return this.bot.sendMessage(chatId, '❌ Por favor, escribe un número válido (mayor a 0).');
    }

    const state = this.userState[chatId];
    
    const result = await db.query('SELECT cantidad FROM productos WHERE id = $1', [state.productoId]);
    const stock = result.rows[0].cantidad;
    if (cantidad > stock) {
      return this.bot.sendMessage(chatId, `❌ Stock insuficiente. Solo hay ${stock} unidades.`);
    }

    let carrito = await this.obtenerCarrito(chatId);
    
    const index = carrito.findIndex(item => item.producto_id === state.productoId);
    if (index !== -1) {
      carrito[index].cantidad += cantidad;
    } else {
      carrito.push({
        producto_id: state.productoId,
        nombre: state.nombre,
        precio: state.precio,
        cantidad: cantidad
      });
    }

    await this.guardarCarrito(chatId, carrito);
    delete this.userState[chatId];

    await this.bot.sendMessage(chatId, 
      `✅ *${cantidad} x ${state.nombre}* agregado al carrito.\n\nPuedes seguir seleccionando productos o presionar "Completar pedido" en el catálogo.`,
      { parse_mode: 'Markdown' }
    );
  }

  async obtenerCarrito(chatId) {
    const res = await db.query(
      'SELECT productos FROM carritos WHERE chat_id = $1',
      [chatId.toString()]
    );
    if (res.rows.length === 0) {
      return [];
    }
    return res.rows[0].productos;
  }

  async guardarCarrito(chatId, productos) {
    await db.query(
      `INSERT INTO carritos (chat_id, productos) VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET productos = $2, updated_at = NOW()`,
      [chatId.toString(), JSON.stringify(productos)]
    );
  }

  async showResumenPedido(chatId, msg) {
    const carrito = await this.obtenerCarrito(chatId);
    if (carrito.length === 0) {
      return this.bot.editMessageText('🛒 Tu carrito está vacío. Agrega productos primero.', {
        chat_id: chatId,
        message_id: msg.message_id
      });
    }

    let total = 0;
    let detalle = '';
    carrito.forEach(item => {
      const subtotal = item.precio * item.cantidad;
      total += subtotal;
      detalle += `• ${item.nombre} x${item.cantidad} = $${subtotal.toFixed(2)}\n`;
    });

    const texto = `🧾 *Resumen de tu pedido:*\n\n${detalle}\n*Total: $${total.toFixed(2)}*\n\n¿Deseas confirmar y pagar?`;

    const inlineKeyboard = [
      [{ text: '💳 Pagar', callback_data: 'pagar_' }],
      [{ text: '❌ Cancelar pedido', callback_data: 'cancelar_pedido_' }],
      [{ text: '🔙 Menú', callback_data: 'menu_' }]
    ];

    await this.bot.editMessageText(texto, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }

  async cancelarPedidoCliente(chatId, msg) {
    await this.guardarCarrito(chatId, []);
    await this.bot.editMessageText('❌ Pedido cancelado. Tu carrito se ha vaciado.', {
      chat_id: chatId,
      message_id: msg.message_id
    });
    await this.showMainMenu(chatId);
  }

  async showMetodosPago(chatId, msg) {
    const inlineKeyboard = [
      [
        { text: '💵 CUP', callback_data: 'metodo_pago_CUP' },
        { text: '💲 USD', callback_data: 'metodo_pago_USD' },
        { text: '💶 MLC', callback_data: 'metodo_pago_MLC' }
      ],
      [{ text: '🔙 Atrás', callback_data: 'completar_' }]
    ];

    await this.bot.editMessageText('💳 *Selecciona el método de pago:*', {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }

  async procesarPago(chatId, metodo, msg) {
    const carrito = await this.obtenerCarrito(chatId);
    if (carrito.length === 0) {
      return this.bot.sendMessage(chatId, '❌ Tu carrito está vacío.');
    }

    let total = 0;
    carrito.forEach(item => { total += item.precio * item.cantidad; });

    // Obtener nombre del cliente (usamos first_name de Telegram)
    let clienteNombre = 'Cliente';
    try {
      const chat = await this.bot.getChat(chatId);
      clienteNombre = chat.first_name || 'Cliente';
    } catch (e) {}

    const pedidoRes = await db.query(
      `INSERT INTO pedidos (cliente_nombre, cliente_chat_id, session_id, estado, total, metodo_pago)
       VALUES ($1, $2, $3, 'pendiente_aprobacion_dueño', $4, $5) RETURNING id`,
      [clienteNombre, chatId.toString(), `telegram_${chatId}`, total, metodo]
    );
    const pedidoId = pedidoRes.rows[0].id;

    for (const item of carrito) {
      await db.query(
        `INSERT INTO items_pedido (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, item.producto_id, item.cantidad, item.precio]
      );
    }

    await this.guardarCarrito(chatId, []);

    // Enviar al dueño
    await this.enviarPedidoAlDueño({
      pedidoId,
      clienteNombre,
      items: carrito,
      total
    });

    await this.bot.editMessageText(
      `✅ *Pedido #${pedidoId} creado*\n\nMonto total: $${total.toFixed(2)}\nMétodo de pago: ${metodo}\n\nTu pedido ha sido enviado al vendedor para aprobación. Te notificaremos cuando sea aceptado.`,
      {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown'
      }
    );

    setTimeout(() => this.showMainMenu(chatId), 3000);
  }

  async showMisPedidos(chatId, msg) {
    try {
      const pedidosRes = await db.query(
        `SELECT * FROM pedidos WHERE cliente_chat_id = $1 ORDER BY fecha_pedido DESC LIMIT 10`,
        [chatId.toString()]
      );
      const pedidos = pedidosRes.rows;

      if (pedidos.length === 0) {
        return this.bot.editMessageText('📭 No tienes pedidos anteriores.', {
          chat_id: chatId,
          message_id: msg.message_id
        });
      }

      let texto = '📦 *Tus pedidos:*\n\n';
      pedidos.forEach(p => {
        let estadoEmoji = '';
        let estadoTexto = p.estado.replace(/_/g, ' ');
        switch (p.estado) {
          case 'pendiente_aprobacion_dueño': estadoEmoji = '⏳'; break;
          case 'aprobado': estadoEmoji = '✅'; break;
          case 'rechazado': estadoEmoji = '❌'; break;
          case 'cancelado_por_cliente': estadoEmoji = '🚫'; break;
          default: estadoEmoji = '📄';
        }
        texto += `${estadoEmoji} *Pedido #${p.id}* - ${new Date(p.fecha_pedido).toLocaleDateString()}\n`;
        texto += `   Total: $${p.total}\n`;
        texto += `   Estado: ${estadoTexto}\n`;
        if (p.metodo_pago) texto += `   Pago: ${p.metodo_pago}\n`;
        texto += '\n';
      });

      const inlineKeyboard = [[{ text: '🔙 Menú principal', callback_data: 'menu_' }]];

      await this.bot.editMessageText(texto, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al obtener tus pedidos.');
    }
  }

  // -----------------------------------------------------------------
  // MÉTODOS COMUNES (aprobación, factura, etc.)
  // -----------------------------------------------------------------
  async enviarPedidoAlDueño(pedido) {
    const { pedidoId, clienteNombre, items, total } = pedido;
    
    let mensaje = `🛒 *Nuevo pedido #${pedidoId}*\n`;
    mensaje += `Cliente: ${clienteNombre}\n`;
    mensaje += `Total: $${total.toFixed(2)}\n\n`;
    mensaje += `*Productos:*\n`;
    items.forEach(item => {
      mensaje += `- ${item.nombre} x${item.cantidad} = $${(item.precio * item.cantidad).toFixed(2)}\n`;
    });

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprobar', callback_data: `aprobar_${pedidoId}` },
          { text: '❌ Rechazar', callback_data: `rechazar_${pedidoId}` }
        ]
      ]
    };

    await this.bot.sendMessage(this.ownerId, mensaje, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
  }

  async aprobarPedido(pedidoId, msg) {
    try {
      // Obtener pedido completo
      const pedidoRes = await db.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
      const pedido = pedidoRes.rows[0];
      
      const itemsRes = await db.query(
        `SELECT ip.*, p.nombre FROM items_pedido ip JOIN productos p ON ip.producto_id = p.id WHERE ip.pedido_id = $1`,
        [pedidoId]
      );
      const items = itemsRes.rows;

      // Descontar stock
      for (const item of items) {
        await db.query(
          'UPDATE productos SET cantidad = cantidad - $1 WHERE id = $2',
          [item.cantidad, item.producto_id]
        );
      }

      // Cambiar estado
      await db.query(
        `UPDATE pedidos SET estado = 'aprobado', fecha_aprobacion = NOW() WHERE id = $1`,
        [pedidoId]
      );

      // Editar mensaje del admin
      await this.bot.editMessageText(
        `✅ *Pedido #${pedidoId} APROBADO*`,
        {
          chat_id: this.ownerId,
          message_id: msg.message_id,
          parse_mode: 'Markdown'
        }
      );

      // Generar factura
      const pdfPath = await generateInvoice({
        orderId: pedidoId,
        cliente_nombre: pedido.cliente_nombre,
        items,
        total: pedido.total,
        fecha: new Date().toLocaleString()
      });

      // Enviar factura al dueño
      await this.bot.sendDocument(this.ownerId, pdfPath, {}, {
        caption: `📄 Factura del pedido #${pedidoId}`
      });

      // Notificar al cliente si es de Telegram
      if (pedido.cliente_chat_id && !pedido.cliente_chat_id.startsWith('web_')) {
        await this.bot.sendMessage(pedido.cliente_chat_id, 
          `✅ *Tu pedido #${pedidoId} ha sido APROBADO!*\n\nPronto será procesado.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(this.ownerId, '❌ Error al aprobar pedido');
    }
  }

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

      // Notificar al cliente si es de Telegram
      const pedidoRes = await db.query('SELECT cliente_chat_id FROM pedidos WHERE id = $1', [pedidoId]);
      const clienteChatId = pedidoRes.rows[0]?.cliente_chat_id;
      if (clienteChatId && !clienteChatId.startsWith('web_')) {
        await this.bot.sendMessage(clienteChatId, 
          `❌ *Tu pedido #${pedidoId} ha sido RECHAZADO.*\n\nContacta al vendedor para más información.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error(error);
    }
  }

  async obtenerPedidoCompleto(pedidoId) {
    const pedidoRes = await db.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    const pedido = pedidoRes.rows[0];
    const itemsRes = await db.query(
      `SELECT ip.*, p.nombre FROM items_pedido ip JOIN productos p ON ip.producto_id = p.id WHERE ip.pedido_id = $1`,
      [pedidoId]
    );
    return { ...pedido, items: itemsRes.rows };
  }
}

module.exports = OrderBot;