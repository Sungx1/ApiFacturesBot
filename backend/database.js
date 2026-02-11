const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const initDB = async () => {
  try {
    // Tabla de productos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        precio DECIMAL(10,2) NOT NULL,
        cantidad INTEGER NOT NULL,
        detalles TEXT,
        tiene_envio BOOLEAN DEFAULT false,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de pedidos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        cliente_nombre TEXT NOT NULL,
        cliente_chat_id TEXT,
        session_id TEXT NOT NULL,
        metodo_pago TEXT,
        estado TEXT NOT NULL DEFAULT 'esperando_confirmacion_cliente',
        fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_aprobacion TIMESTAMP,
        total DECIMAL(10,2)
      )
    `);

    // Tabla de items de pedido
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items_pedido (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        cantidad INTEGER NOT NULL,
        precio_unitario DECIMAL(10,2) NOT NULL
      )
    `);

    // Tabla de carritos (para clientes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS carritos (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL UNIQUE,
        productos JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Base de datos inicializada');
  } catch (error) {
    console.error('❌ Error inicializando DB:', error);
  }
};

initDB();

module.exports = {
  query: (text, params) => pool.query(text, params)
};