// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');
const OrderBot = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar bot
const bot = new OrderBot(process.env.BOT_TOKEN, process.env.OWNER_CHAT_ID);

// -------------------- ENDPOINTS PÚBLICOS --------------------

// Obtener todos los productos (catálogo)
app.get('/api/productos', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM productos WHERE cantidad > 0 ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Crear un nuevo pedido (desde la web)
app.post('/api/pedido', async (req, res) => {
  const { sessionId, clienteNombre, items } = req.body;
  
  if (!sessionId || !clienteNombre || !items || items.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    // Verificar stock y calcular total
    let total = 0;
    const itemsConDetalle = [];

    for (const item of items) {
      const prodRes = await db.query(
        'SELECT * FROM productos WHERE id = $1',
        [item.producto_id]
      );
      
      if (prodRes.rows.length === 0) {
        return res.status(404).json({ error: `Producto ${item.producto_id} no encontrado` });
      }

      const producto = prodRes.rows[0];
      if (producto.cantidad < item.cantidad) {
        return res.status(400).json({ error: `Stock insuficiente para ${producto.nombre}` });
      }

      const subtotal = producto.precio * item.cantidad;
      total += subtotal;
      
      itemsConDetalle.push({
        ...item,
        precio_unitario: producto.precio,
        nombre: producto.nombre
      });
    }

    // Insertar pedido
    const pedidoRes = await db.query(
      `INSERT INTO pedidos (cliente_nombre, session_id, total, estado) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [clienteNombre, sessionId, total, 'esperando_confirmacion_cliente']
    );
    const pedidoId = pedidoRes.rows[0].id;

    // Insertar items
    for (const item of itemsConDetalle) {
      await db.query(
        `INSERT INTO items_pedido (pedido_id, producto_id, cantidad, precio_unitario) 
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, item.producto_id, item.cantidad, item.precio_unitario]
      );
    }

    res.json({
      success: true,
      pedidoId,
      mensaje: 'Pedido creado. Por favor confirma los detalles.'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear pedido' });
  }
});

// Obtener el último pedido de una sesión
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

    const itemsRes = await db.query(`
      SELECT ip.*, p.nombre 
      FROM items_pedido ip
      JOIN productos p ON ip.producto_id = p.id
      WHERE ip.pedido_id = $1
    `, [pedido.id]);
    
    pedido.items = itemsRes.rows;
    res.json(pedido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener pedido' });
  }
});

// Confirmar pedido (cliente pulsa "Confirmar" en la web)
app.post('/api/pedido/:pedidoId/confirmar', async (req, res) => {
  const { pedidoId } = req.params;
  try {
    // Cambiar estado
    const updateRes = await db.query(
      `UPDATE pedidos SET estado = 'pendiente_aprobacion_dueño' 
       WHERE id = $1 AND estado = 'esperando_confirmacion_cliente'`,
      [pedidoId]
    );
    
    if (updateRes.rowCount === 0) {
      return res.status(400).json({ error: 'Pedido no encontrado o ya confirmado' });
    }

    // Obtener pedido completo
    const pedidoRes = await db.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    const pedido = pedidoRes.rows[0];

    const itemsRes = await db.query(`
      SELECT ip.*, p.nombre 
      FROM items_pedido ip
      JOIN productos p ON ip.producto_id = p.id
      WHERE ip.pedido_id = $1
    `, [pedidoId]);
    pedido.items = itemsRes.rows;

    // Enviar al dueño para aprobación
    await bot.enviarPedidoAlDueño(pedido);

    res.json({ success: true, mensaje: 'Pedido enviado al vendedor para aprobación' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al confirmar pedido' });
  }
});

// Cancelar pedido (cliente pulsa "Cancelar")
app.post('/api/pedido/:pedidoId/cancelar', async (req, res) => {
  const { pedidoId } = req.params;
  try {
    const updateRes = await db.query(
      `UPDATE pedidos SET estado = 'cancelado_por_cliente' 
       WHERE id = $1 AND estado = 'esperando_confirmacion_cliente'`,
      [pedidoId]
    );
    if (updateRes.rowCount === 0) {
      return res.status(400).json({ error: 'No se pudo cancelar' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cancelar pedido' });
  }
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Bot API funcionando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});