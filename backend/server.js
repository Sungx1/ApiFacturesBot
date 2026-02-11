require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');
const OrderBot = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

const bot = new OrderBot(process.env.BOT_TOKEN, process.env.OWNER_CHAT_ID);

// -------------------- ENDPOINTS PÚBLICOS --------------------

// Obtener todos los productos disponibles
app.get('/api/productos', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM productos WHERE cantidad > 0 ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- ENDPOINTS PARA CARRITO (WEB) --------------------

// Obtener carrito de una sesión web
app.get('/api/carrito/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const result = await db.query(
      'SELECT productos FROM carritos WHERE chat_id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) {
      return res.json([]);
    }
    res.json(result.rows[0].productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar producto al carrito (web)
app.post('/api/carrito/agregar', async (req, res) => {
  const { sessionId, producto_id, cantidad } = req.body;
  if (!sessionId || !producto_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const prodRes = await db.query('SELECT * FROM productos WHERE id = $1', [producto_id]);
    const producto = prodRes.rows[0];
    if (!producto) return res.status(404).json({ error: 'Producto no existe' });
    if (producto.cantidad < cantidad) {
      return res.status(400).json({ error: 'Stock insuficiente' });
    }

    let carrito = [];
    const carritoRes = await db.query('SELECT productos FROM carritos WHERE chat_id = $1', [sessionId]);
    if (carritoRes.rows.length > 0) {
      carrito = carritoRes.rows[0].productos;
    }

    const index = carrito.findIndex(item => item.producto_id === producto_id);
    if (index !== -1) {
      carrito[index].cantidad += cantidad;
    } else {
      carrito.push({
        producto_id: producto.id,
        nombre: producto.nombre,
        precio: parseFloat(producto.precio),
        cantidad: cantidad
      });
    }

    await db.query(
      `INSERT INTO carritos (chat_id, productos) VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET productos = $2, updated_at = NOW()`,
      [sessionId, JSON.stringify(carrito)]
    );

    res.json({ success: true, carrito });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar producto del carrito (web)
app.post('/api/carrito/eliminar', async (req, res) => {
  const { sessionId, producto_id } = req.body;
  try {
    const carritoRes = await db.query('SELECT productos FROM carritos WHERE chat_id = $1', [sessionId]);
    if (carritoRes.rows.length === 0) return res.json({ success: true, carrito: [] });
    
    let carrito = carritoRes.rows[0].productos;
    carrito = carrito.filter(item => item.producto_id !== producto_id);
    
    await db.query(
      `UPDATE carritos SET productos = $1, updated_at = NOW() WHERE chat_id = $2`,
      [JSON.stringify(carrito), sessionId]
    );
    res.json({ success: true, carrito });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear pedido desde la web (con método de pago)
app.post('/api/pedido', async (req, res) => {
  const { sessionId, clienteNombre, items, metodoPago } = req.body;
  
  if (!sessionId || !clienteNombre || !items || items.length === 0 || !metodoPago) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    let total = 0;
    const itemsConPrecio = [];

    for (const item of items) {
      const prodRes = await db.query('SELECT * FROM productos WHERE id = $1', [item.producto_id]);
      const prod = prodRes.rows[0];
      if (!prod) return res.status(404).json({ error: `Producto ${item.producto_id} no encontrado` });
      if (prod.cantidad < item.cantidad) {
        return res.status(400).json({ error: `Stock insuficiente para ${prod.nombre}` });
      }
      const subtotal = parseFloat(prod.precio) * item.cantidad;
      total += subtotal;
      itemsConPrecio.push({
        ...item,
        nombre: prod.nombre,
        precio_unitario: parseFloat(prod.precio)
      });
    }

    const pedidoRes = await db.query(
      `INSERT INTO pedidos (cliente_nombre, session_id, estado, total, metodo_pago, cliente_chat_id)
       VALUES ($1, $2, 'pendiente_aprobacion_dueño', $3, $4, $5) RETURNING id`,
      [clienteNombre, sessionId, total, metodoPago, `web_${sessionId}`]
    );
    const pedidoId = pedidoRes.rows[0].id;

    for (const item of itemsConPrecio) {
      await db.query(
        `INSERT INTO items_pedido (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, item.producto_id, item.cantidad, item.precio_unitario]
      );
    }

    // Limpiar carrito
    await db.query('DELETE FROM carritos WHERE chat_id = $1', [sessionId]);

    // Enviar al dueño
    await bot.enviarPedidoAlDueño({
      pedidoId,
      clienteNombre,
      items: itemsConPrecio,
      total
    });

    res.json({ success: true, pedidoId, mensaje: 'Pedido enviado al vendedor' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Obtener pedidos de un cliente por sessionId (web)
app.get('/api/pedidos/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const pedidosRes = await db.query(
      `SELECT * FROM pedidos WHERE session_id = $1 ORDER BY fecha_pedido DESC`,
      [sessionId]
    );
    res.json(pedidosRes.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener el último pedido de una sesión (para seguimiento web)
app.get('/api/pedido/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const pedidoRes = await db.query(
      `SELECT * FROM pedidos WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
      [sessionId]
    );
    if (pedidoRes.rows.length === 0) {
      return res.status(404).json({ error: 'No hay pedido activo' });
    }
    const pedido = pedidoRes.rows[0];
    
    const itemsRes = await db.query(
      `SELECT ip.*, p.nombre FROM items_pedido ip JOIN productos p ON ip.producto_id = p.id WHERE ip.pedido_id = $1`,
      [pedido.id]
    );
    pedido.items = itemsRes.rows;
    
    res.json(pedido);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Bot API funcionando ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});