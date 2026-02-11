const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const generateInvoice = require('./invoiceGenerator');

class OrderBot {
  constructor(token, ownerId) {
    this.token = token;
    this.ownerId = ownerId; // Único admin
    this.userState = {};
    
    if (process.env.NODE_ENV === 'production') {
      this.bot = new TelegramBot(token);
    } else {
      this.bot = new TelegramBot(token, { polling: true });
      this.initHandlers();
    }
  }

  initHandlers() {
    // -------------------- MENSAJES DE TEXTO --------------------
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (text && text.startsWith('/')) return;

      // Si es admin y está en flujo de agregar producto
      if (chatId == this.ownerId && this.userState[chatId]) {
        const state = this.userState[chatId];
        if (state.step === 'awaiting_product_name') await this.handleAddProductName(msg);
        else if (state.step === 'awaiting_product_price') await this.handleAddProductPrice(msg);
        else if (state.step === 'awaiting_product_stock') await this.handleAddProductStock(msg);
        else if (state.step === 'awaiting_product_details') await this.handleAddProductDetails(msg);
        return;
      }

      // Si es cliente y está esperando cantidad
      if (this.userState[chatId]?.step === 'awaiting_quantity') {
        await this.handleQuantityInput(msg);
        return;
      }

      // Si es admin y no está en flujo, no hacer nada (solo comandos)
      if (chatId == this.ownerId) return;

      // Cliente: mostrar menú principal
      await this.showMainMenu(chatId);
    });

    // -------------------- COMANDOS --------------------
    this.bot.onText(/\/start/, async (msg) => {
      if (msg.chat.id == this.ownerId) {
        await this.showAdminMenu(msg.chat.id);
      } else {
        await this.showMainMenu(msg.chat.id);
      }
    });

    this.bot.onText(/\/admin/, async (msg) => {
      if (msg.chat.id == this.ownerId) {
        await this.showAdminMenu(msg.chat.id);
      } else {
        await this.bot.sendMessage(msg.chat.id, '⛔ No autorizado.');
      }
    });

    this.bot.onText(/\/reiniciar/, async (msg) => {
      if (msg.chat.id == this.ownerId) {
        await this.resetDatabase(msg.chat.id);
      }
    });

    // -------------------- CALLBACK QUERIES --------------------
    this.bot.on('callback_query', async (callbackQuery) => {
      const data = callbackQuery.data;
      const msg = callbackQuery.message;
      const chatId = msg.chat.id;

      // ------ ADMIN ------
      if (chatId == this.ownerId) {
        if (data.startsWith('aprobar_') || data.startsWith('rechazar_')) {
          const [accion, pedidoId] = data.split('_');
          if (accion === 'aprobar') await this.aprobarPedido(pedidoId, msg);
          else await this.rechazarPedido(pedidoId, msg);
          this.bot.answerCallbackQuery(callbackQuery.id);
          return;
        }
        if (data === 'admin_menu') { await this.showAdminMenu(chatId, msg); }
        else if (data === 'admin_add_product') { await this.startAddProduct(chatId, msg); }
        else if (data === 'admin_list_products') { await this.listProductsForAdmin(chatId, msg); }
        else if (data === 'admin_delete_product') { await this.startDeleteProduct(chatId, msg); }
        else if (data.startsWith('delproduct_')) {
          const productId = data.split('_')[1];
          await this.deleteProduct(chatId, productId, msg);
        }
        else if (data === 'admin_view_orders') { await this.viewOrders(chatId, msg); }
        else if (data === 'reiniciar_bot') { await this.resetDatabase(chatId, msg); }
        else if (data === 'envio_si' || data === 'envio_no') {
          const tieneEnvio = data === 'envio_si' ? 'si' : 'no';
          await this.handleShippingCallback(chatId, tieneEnvio, msg);
        }
        this.bot.answerCallbackQuery(callbackQuery.id);
        return;
      }

      // ------ CLIENTES ------
      if (data === 'menu') { await this.showMainMenu(chatId, msg); }
      else if (data === 'catalogo_') { await this.showCatalogo(chatId, msg); }
      else if (data.startsWith('producto_')) {
        const productoId = parseInt(data.split('_')[1]);
        await this.selectProduct(chatId, productoId, msg);
      }
      else if (data === 'completar_') { await this.showResumenPedido(chatId, msg); }
      else if (data === 'cancelar_pedido_') { await this.cancelarPedidoCliente(chatId, msg); }
      else if (data === 'pagar_') { await this.showMetodosPago(chatId, msg); }
      else if (data.startsWith('metodo_pago_')) {
        const metodo = data.split('_')[2];
        await this.procesarPago(chatId, metodo, msg);
      }
      else if (data === 'mis_pedidos_') { await this.showMisPedidos(chatId, msg); }

      this.bot.answerCallbackQuery(callbackQuery.id);
    });
  }

  // ==================== ADMIN ====================
  async showAdminMenu(chatId, msg = null) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ Agregar producto', callback_data: 'admin_add_product' }],
        [{ text: '🗑️ Eliminar producto', callback_data: 'admin_delete_product' }],
        [{ text: '📋 Ver productos', callback_data: 'admin_list_products' }],
        [{ text: '📦 Ver pedidos', callback_data: 'admin_view_orders' }],
        [{ text: '🔄 Reiniciar bot', callback_data: 'reiniciar_bot' }]
      ]
    };
    const text = '🛠️ *Panel de Administración*\nElige una opción:';
    if (msg) {
      await this.bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  async startAddProduct(chatId, msg) {
    this.userState[chatId] = { step: 'awaiting_product_name' };
    await this.bot.editMessageText('✏️ Ingresa el *nombre* del producto:', {
      chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown'
    });
  }

  async handleAddProductName(msg) {
    const chatId = msg.chat.id;
    const nombre = msg.text;
    if (!nombre || nombre.length < 2) return this.bot.sendMessage(chatId, '❌ Nombre inválido. Intenta de nuevo:');
    this.userState[chatId] = { step: 'awaiting_product_price', nombre };
    await this.bot.sendMessage(chatId, '💰 Ingresa el *precio* (ejemplo: 15.50):', { parse_mode: 'Markdown' });
  }

  async handleAddProductPrice(msg) {
    const chatId = msg.chat.id;
    const precio = parseFloat(msg.text);
    if (isNaN(precio) || precio <= 0) return this.bot.sendMessage(chatId, '❌ Precio inválido. Ingresa un número positivo:');
    this.userState[chatId].precio = precio;
    this.userState[chatId].step = 'awaiting_product_stock';
    await this.bot.sendMessage(chatId, '📦 Ingresa el *stock* (cantidad disponible):', { parse_mode: 'Markdown' });
  }

  async handleAddProductStock(msg) {
    const chatId = msg.chat.id;
    const stock = parseInt(msg.text);
    if (isNaN(stock) || stock < 0) return this.bot.sendMessage(chatId, '❌ Stock inválido. Ingresa un número entero no negativo:');
    this.userState[chatId].stock = stock;
    this.userState[chatId].step = 'awaiting_product_details';
    await this.bot.sendMessage(chatId, '📝 Ingresa los *detalles* del producto (o escribe "ninguno"):', { parse_mode: 'Markdown' });
  }

  async handleAddProductDetails(msg) {
    const chatId = msg.chat.id;
    const detalles = msg.text === 'ninguno' ? '' : msg.text;
    this.userState[chatId].detalles = detalles;
    this.userState[chatId].step = 'awaiting_shipping_callback';
    const keyboard = { inline_keyboard: [[{ text: 'Sí', callback_data: 'envio_si' }, { text: 'No', callback_data: 'envio_no' }]] };
    await this.bot.sendMessage(chatId, '🚚 ¿El producto tiene envío?', { reply_markup: keyboard });
  }

  async handleShippingCallback(chatId, tieneEnvio, msg) {
    if (!this.userState[chatId] || this.userState[chatId].step !== 'awaiting_shipping_callback') return;
    const state = this.userState[chatId];
    const tiene_envio = (tieneEnvio === 'si');
    try {
      await db.query(
        `INSERT INTO productos (nombre, precio, cantidad, detalles, tiene_envio) VALUES ($1, $2, $3, $4, $5)`,
        [state.nombre, state.precio, state.stock, state.detalles, tiene_envio]
      );
      await this.bot.sendMessage(chatId, '✅ Producto agregado exitosamente.');
      delete this.userState[chatId];
      await this.showAdminMenu(chatId);
    } catch (error) {
      console.error(error);
      await this.bot.sendMessage(chatId, '❌ Error al guardar producto.');
    }
  }

  async startDeleteProduct(chatId, msg) {
    const result = await db.query('SELECT id, nombre, precio FROM productos ORDER BY id');
    const productos = result.rows;
    if (productos.length === 0) {
      return this.bot.editMessageText('📭 No hay productos para eliminar.', { chat_id: chatId, message_id: msg.message_id });
    }
    let keyboard = productos.map(p => ([{ text: `${p.id} - ${p.nombre} ($${p.precio})`, callback_data: `delproduct_${p.id}` }]));
    keyboard.push([{ text: '🔙 Cancelar', callback_data: 'admin_menu' }]);
    await this.bot.editMessageText('🗑️ *Selecciona el producto a eliminar:*', {
      chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
  }

  async deleteProduct(chatId, productId, msg) {
    try {
      await db.query('DELETE FROM productos WHERE id = $1', [productId]);
      await this.bot.editMessageText('✅ Producto eliminado.', { chat_id: chatId, message_id: msg.message_id });
      await this.showAdminMenu(chatId);
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al eliminar producto.');
    }
  }

  async listProductsForAdmin(chatId, msg) {
    const result = await db.query('SELECT * FROM productos ORDER BY id');
    const productos = result.rows;
    if (productos.length === 0) {
      return this.bot.editMessageText('📭 No hay productos cargados.', { chat_id: chatId, message_id: msg.message_id });
    }
    let text = '📦 *Productos en inventario:*\n\n';
    productos.forEach(p => {
      text += `ID: ${p.id}\n📌 ${p.nombre}\n💰 $${p.precio}\n📦 Stock: ${p.cantidad}\n📝 ${p.detalles || 'Sin detalles'}\n🚚 ${p.tiene_envio ? 'Con envío' : 'Sin envío'}\n🕒 Creado: ${new Date(p.creado_en).toLocaleString()}\n\n`;
    });
    const keyboard = { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'admin_menu' }]] };
    await this.bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async viewOrders(chatId, msg) {
    const result = await db.query(`SELECT * FROM pedidos ORDER BY fecha_pedido DESC LIMIT 20`);
    const pedidos = result.rows;
    if (pedidos.length === 0) {
      return this.bot.editMessageText('📭 No hay pedidos.', { chat_id: chatId, message_id: msg.message_id });
    }
    let text = '📦 *Últimos pedidos:*\n\n';
    pedidos.forEach(p => {
      text += `*Pedido #${p.id}* - ${new Date(p.fecha_pedido).toLocaleString()}\nCliente: ${p.cliente_nombre}\nTotal: $${p.total}\nEstado: ${p.estado.replace(/_/g, ' ')}\n${p.metodo_pago ? `Pago: ${p.metodo_pago}\n` : ''}\n`;
    });
    const keyboard = { inline_keyboard: [[{ text: '🔙 Volver al menú', callback_data: 'admin_menu' }]] };
    await this.bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async resetDatabase(chatId, msg = null) {
    try {
      await db.query('TRUNCATE TABLE items_pedido, pedidos, carritos, productos RESTART IDENTITY CASCADE');
      if (msg) {
        try { await this.bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
      }
      await this.bot.sendMessage(chatId, '✅ *Base de datos reiniciada.*\nTodos los productos, pedidos y carritos han sido eliminados.\n\nEl bot está como nuevo.', { parse_mode: 'Markdown' });
      await this.showAdminMenu(chatId);
    } catch (error) {
      console.error(error);
      await this.bot.sendMessage(chatId, '❌ Error al reiniciar la base de datos.');
    }
  }

  // ==================== CLIENTES ====================
  async showMainMenu(chatId, msg = null) {
    const menu = { inline_keyboard: [[{ text: '📋 Consultar Catálogo', callback_data: 'catalogo_' }], [{ text: '📦 Mis Pedidos', callback_data: 'mis_pedidos_' }]] };
    const texto = '🛍️ *Bienvenido a la Tienda Online*\n\nElige una opción:';
    if (msg) {
      await this.bot.editMessageText(texto, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: menu });
    } else {
      await this.bot.sendMessage(chatId, texto, { parse_mode: 'Markdown', reply_markup: menu });
    }
  }

  async showCatalogo(chatId, msg) {
    try {
      const result = await db.query('SELECT * FROM productos WHERE cantidad > 0 ORDER BY nombre');
      const productos = result.rows;
      if (productos.length === 0) {
        return this.bot.editMessageText('📭 No hay productos disponibles.', { chat_id: chatId, message_id: msg.message_id });
      }
      let inlineKeyboard = productos.map(p => ([{ text: `${p.nombre} - $${p.precio}`, callback_data: `producto_${p.id}` }]));
      inlineKeyboard.push([{ text: '✅ Completar pedido', callback_data: 'completar_' }]);
      inlineKeyboard.push([{ text: '🔙 Menú principal', callback_data: 'menu' }]);
      await this.bot.editMessageText('📦 *Selecciona los productos que deseas:*\n(Al presionar un producto, escribe la cantidad)', {
        chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard }
      });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al cargar catálogo.');
    }
  }

  async selectProduct(chatId, productoId, msg) {
    const result = await db.query('SELECT * FROM productos WHERE id = $1', [productoId]);
    const producto = result.rows[0];
    if (!producto) return this.bot.sendMessage(chatId, '❌ Producto no encontrado.');
    this.userState[chatId] = { step: 'awaiting_quantity', productoId: producto.id, nombre: producto.nombre, precio: producto.precio, messageId: msg.message_id };
    await this.bot.sendMessage(chatId, `🛒 *${producto.nombre}*\nPrecio: $${producto.precio}\nStock: ${producto.cantidad}\n\nEscribe la cantidad que deseas:`, { parse_mode: 'Markdown' });
  }

  async handleQuantityInput(msg) {
    const chatId = msg.chat.id;
    const cantidad = parseInt(msg.text);
    if (isNaN(cantidad) || cantidad <= 0) return this.bot.sendMessage(chatId, '❌ Por favor, escribe un número válido (mayor a 0).');
    const state = this.userState[chatId];
    const result = await db.query('SELECT cantidad FROM productos WHERE id = $1', [state.productoId]);
    const stock = result.rows[0].cantidad;
    if (cantidad > stock) return this.bot.sendMessage(chatId, `❌ Stock insuficiente. Solo hay ${stock} unidades.`);

    let carrito = await this.obtenerCarrito(chatId);
    const index = carrito.findIndex(item => item.producto_id === state.productoId);
    if (index !== -1) carrito[index].cantidad += cantidad;
    else carrito.push({ producto_id: state.productoId, nombre: state.nombre, precio: state.precio, cantidad });
    await this.guardarCarrito(chatId, carrito);
    delete this.userState[chatId];
    await this.bot.sendMessage(chatId, `✅ *${cantidad} x ${state.nombre}* agregado al carrito.\n\nPuedes seguir seleccionando productos o presionar "Completar" en el catálogo.`, { parse_mode: 'Markdown' });
    if (state.messageId) { try { await this.bot.deleteMessage(chatId, state.messageId); } catch (e) {} }
  }

  async obtenerCarrito(chatId) {
    const res = await db.query('SELECT productos FROM carritos WHERE chat_id = $1', [chatId.toString()]);
    return res.rows.length ? res.rows[0].productos : [];
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
    if (carrito.length === 0) return this.bot.editMessageText('🛒 Tu carrito está vacío. Agrega productos primero.', { chat_id: chatId, message_id: msg.message_id });
    let total = 0, detalle = '';
    carrito.forEach(item => { const subtotal = item.precio * item.cantidad; total += subtotal; detalle += `• ${item.nombre} x${item.cantidad} = $${subtotal.toFixed(2)}\n`; });
    const texto = `🧾 *Resumen de tu pedido:*\n\n${detalle}\n*Total: $${total.toFixed(2)}*\n\n¿Deseas confirmar y pagar?`;
    const inlineKeyboard = [[{ text: '💳 Pagar', callback_data: 'pagar_' }], [{ text: '❌ Cancelar pedido', callback_data: 'cancelar_pedido_' }], [{ text: '🔙 Menú', callback_data: 'menu' }]];
    await this.bot.editMessageText(texto, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
  }

  async cancelarPedidoCliente(chatId, msg) {
    await this.guardarCarrito(chatId, []);
    await this.bot.editMessageText('❌ Pedido cancelado. Tu carrito se ha vaciado.', { chat_id: chatId, message_id: msg.message_id });
    await this.showMainMenu(chatId);
  }

  async showMetodosPago(chatId, msg) {
    const inlineKeyboard = [[{ text: '💵 CUP', callback_data: 'metodo_pago_CUP' }, { text: '💲 USD', callback_data: 'metodo_pago_USD' }, { text: '💶 MLC', callback_data: 'metodo_pago_MLC' }], [{ text: '🔙 Atrás', callback_data: 'completar_' }]];
    await this.bot.editMessageText('💳 *Selecciona el método de pago:*', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
  }

  async procesarPago(chatId, metodo, msg) {
    const carrito = await this.obtenerCarrito(chatId);
    if (carrito.length === 0) return this.bot.sendMessage(chatId, '❌ Tu carrito está vacío.');
    let total = 0; carrito.forEach(item => { total += item.precio * item.cantidad; });
    const clienteNombre = msg.from?.first_name || `Cliente ${chatId}`;
    const pedidoRes = await db.query(
      `INSERT INTO pedidos (cliente_nombre, cliente_chat_id, session_id, estado, total, metodo_pago)
       VALUES ($1, $2, $3, 'pendiente_aprobacion_dueño', $4, $5) RETURNING id`,
      [clienteNombre, chatId.toString(), `telegram_${chatId}`, total, metodo]
    );
    const pedidoId = pedidoRes.rows[0].id;
    for (const item of carrito) {
      await db.query(`INSERT INTO items_pedido (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`,
        [pedidoId, item.producto_id, item.cantidad, item.precio]);
    }
    await this.guardarCarrito(chatId, []);
    await this.enviarPedidoAlDueño({ pedidoId, clienteNombre, items: carrito, total, metodo });
    await this.bot.editMessageText(`✅ *Pedido #${pedidoId} creado*\n\nMonto total: $${total.toFixed(2)}\nMétodo de pago: ${metodo}\n\nTu pedido ha sido enviado al vendedor para aprobación.`, {
      chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown'
    });
    setTimeout(() => this.showMainMenu(chatId), 3000);
  }

  async showMisPedidos(chatId, msg) {
    try {
      const pedidosRes = await db.query(`SELECT * FROM pedidos WHERE cliente_chat_id = $1 ORDER BY fecha_pedido DESC LIMIT 10`, [chatId.toString()]);
      const pedidos = pedidosRes.rows;
      if (pedidos.length === 0) return this.bot.editMessageText('📭 No tienes pedidos anteriores.', { chat_id: chatId, message_id: msg.message_id });
      let texto = '📦 *Tus pedidos:*\n\n';
      pedidos.forEach(p => {
        let estadoEmoji = '';
        switch (p.estado) {
          case 'pendiente_aprobacion_dueño': estadoEmoji = '⏳'; break;
          case 'aprobado': estadoEmoji = '✅'; break;
          case 'rechazado': estadoEmoji = '❌'; break;
          case 'cancelado_por_cliente': estadoEmoji = '🚫'; break;
          default: estadoEmoji = '📄';
        }
        texto += `${estadoEmoji} *Pedido #${p.id}* - ${new Date(p.fecha_pedido).toLocaleDateString()}\n   Total: $${p.total}\n   Estado: ${p.estado.replace(/_/g, ' ')}\n   Pago: ${p.metodo_pago || 'N/A'}\n\n`;
      });
      texto += '\n🔙 Presiona el botón para volver.';
      const inlineKeyboard = [[{ text: '🔙 Menú principal', callback_data: 'menu' }]];
      await this.bot.editMessageText(texto, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(chatId, '❌ Error al obtener tus pedidos.');
    }
  }

  // ==================== MÉTODOS COMPARTIDOS ====================
  async enviarPedidoAlDueño(pedido) {
    const { pedidoId, clienteNombre, items, total, metodo } = pedido;
    let mensaje = `🛒 *Nuevo pedido #${pedidoId}*\nCliente: ${clienteNombre}\nTotal: $${total.toFixed(2)}\n${metodo ? `Método de pago: ${metodo}\n\n` : '\n'}*Productos:*\n`;
    items.forEach(item => { mensaje += `- ${item.nombre} x${item.cantidad} = $${(item.precio * item.cantidad).toFixed(2)}\n`; });
    const inlineKeyboard = { inline_keyboard: [[{ text: '✅ Aprobar', callback_data: `aprobar_${pedidoId}` }, { text: '❌ Rechazar', callback_data: `rechazar_${pedidoId}` }]] };
    await this.bot.sendMessage(this.ownerId, mensaje, { parse_mode: 'Markdown', reply_markup: inlineKeyboard });
  }

  async aprobarPedido(pedidoId, msg) {
    try {
      const itemsRes = await db.query(`SELECT producto_id, cantidad FROM items_pedido WHERE pedido_id = $1`, [pedidoId]);
      const items = itemsRes.rows;
      for (const item of items) {
        await db.query(`UPDATE productos SET cantidad = cantidad - $1 WHERE id = $2 AND cantidad >= $1`, [item.cantidad, item.producto_id]);
      }
      await db.query(`UPDATE pedidos SET estado = 'aprobado', fecha_aprobacion = NOW() WHERE id = $1`, [pedidoId]);
      await this.bot.editMessageText(`✅ *Pedido #${pedidoId} APROBADO*`, { chat_id: this.ownerId, message_id: msg.message_id, parse_mode: 'Markdown' });
      const pedidoRes = await db.query(`SELECT * FROM pedidos WHERE id = $1`, [pedidoId]);
      const pedido = pedidoRes.rows[0];
      const itemsDetalle = await db.query(`SELECT ip.*, p.nombre FROM items_pedido ip JOIN productos p ON ip.producto_id = p.id WHERE ip.pedido_id = $1`, [pedidoId]);
      const pdfPath = await generateInvoice({ orderId: pedidoId, cliente_nombre: pedido.cliente_nombre, items: itemsDetalle.rows, total: pedido.total, fecha: pedido.fecha_aprobacion });
      await this.bot.sendDocument(this.ownerId, pdfPath, {}, { caption: `📄 Factura del pedido #${pedidoId}` });
      if (pedido.cliente_chat_id && !pedido.cliente_chat_id.startsWith('web_')) {
        await this.bot.sendMessage(pedido.cliente_chat_id, `✅ *Pedido #${pedidoId} APROBADO*\nGracias por tu compra.`, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(error);
      this.bot.sendMessage(this.ownerId, '❌ Error al aprobar pedido.');
    }
  }

  async rechazarPedido(pedidoId, msg) {
    try {
      await db.query(`UPDATE pedidos SET estado = 'rechazado' WHERE id = $1`, [pedidoId]);
      await this.bot.editMessageText(`❌ *Pedido #${pedidoId} RECHAZADO*`, { chat_id: this.ownerId, message_id: msg.message_id, parse_mode: 'Markdown' });
      const pedidoRes = await db.query(`SELECT cliente_chat_id FROM pedidos WHERE id = $1`, [pedidoId]);
      const pedido = pedidoRes.rows[0];
      if (pedido.cliente_chat_id && !pedido.cliente_chat_id.startsWith('web_')) {
        await this.bot.sendMessage(pedido.cliente_chat_id, `❌ *Pedido #${pedidoId} RECHAZADO*\nLo sentimos, tu pedido no pudo ser procesado.`, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(error);
    }
  }
}

module.exports = OrderBot;