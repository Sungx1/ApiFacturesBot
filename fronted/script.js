const API_URL = 'https://tu-backend.onrender.com/api'; // CAMBIAR por tu URL de Render
let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
  sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('sessionId', sessionId);
}

let carrito = [];
let clienteNombre = localStorage.getItem('clienteNombre') || '';
let ultimoPedidoId = null;

// Elementos DOM
const catalogoSection = document.getElementById('catalogo');
const resumenSection = document.getElementById('resumen');
const pagoSection = document.getElementById('metodos-pago');
const confirmacionSection = document.getElementById('confirmacion');
const misPedidosSection = document.getElementById('mis-pedidos');
const modalNombre = document.getElementById('modal-nombre');

// Eventos
document.getElementById('btnCatalogo').addEventListener('click', mostrarCatalogo);
document.getElementById('btnMisPedidos').addEventListener('click', mostrarMisPedidos);
document.getElementById('btnCompletar').addEventListener('click', mostrarResumen);
document.getElementById('btnPagar').addEventListener('click', mostrarMetodosPago);
document.getElementById('btnCancelarPedido').addEventListener('click', cancelarPedido);
document.getElementById('btnVolverCatalogo').addEventListener('click', mostrarCatalogo);
document.getElementById('btnAtrasResumen').addEventListener('click', mostrarResumen);
document.getElementById('btnVolverInicio').addEventListener('click', () => mostrarCatalogo());
document.getElementById('btnVolverDesdePedidos').addEventListener('click', mostrarCatalogo);
document.querySelectorAll('.metodo').forEach(btn => {
  btn.addEventListener('click', (e) => procesarPago(e.target.dataset.metodo));
});

// Inicializar: cargar catálogo y carrito
cargarCatalogo();
cargarCarrito();

async function cargarCatalogo() {
  try {
    const res = await fetch(`${API_URL}/productos`);
    if (!res.ok) throw new Error('Error al cargar productos');
    const productos = await res.json();
    const grid = document.getElementById('productos-grid');
    if (productos.length === 0) {
      grid.innerHTML = '<p>No hay productos disponibles.</p>';
      return;
    }
    grid.innerHTML = productos.map(p => `
      <div class="producto-card">
        <h3>${p.nombre}</h3>
        <p class="precio">$${parseFloat(p.precio).toFixed(2)}</p>
        <p class="stock">Stock: ${p.cantidad}</p>
        <p>${p.detalles || ''}</p>
        <p>${p.tiene_envio ? '🚚 Con envío' : '📍 Retiro local'}</p>
        <button class="btn-agregar" data-id="${p.id}" data-nombre="${p.nombre}" data-precio="${p.precio}">Agregar</button>
      </div>
    `).join('');
    document.querySelectorAll('.btn-agregar').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const nombre = e.target.dataset.nombre;
        const precio = parseFloat(e.target.dataset.precio);
        agregarAlCarrito(id, nombre, precio);
      });
    });
  } catch (error) {
    console.error(error);
    document.getElementById('productos-grid').innerHTML = '<p>Error al cargar productos.</p>';
  }
}

async function cargarCarrito() {
  try {
    const res = await fetch(`${API_URL}/carrito/${sessionId}`);
    if (res.ok) {
      carrito = await res.json();
      renderCarrito();
    }
  } catch (error) {
    console.error('Error cargando carrito:', error);
  }
}

async function agregarAlCarrito(productoId, nombre, precio) {
  const cantidad = parseInt(prompt(`¿Cuántos ${nombre} deseas?`, '1'));
  if (!cantidad || cantidad <= 0) return alert('Cantidad inválida');
  try {
    const res = await fetch(`${API_URL}/carrito/agregar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, producto_id: productoId, cantidad })
    });
    const data = await res.json();
    if (data.success) {
      carrito = data.carrito;
      renderCarrito();
      alert('✅ Producto agregado');
    } else {
      alert(data.error || 'Error al agregar');
    }
  } catch (error) {
    alert('Error de conexión');
  }
}

function renderCarrito() {
  const divItems = document.getElementById('carrito-items');
  const divTotal = document.getElementById('carrito-total');
  if (carrito.length === 0) {
    divItems.innerHTML = '<p>Carrito vacío</p>';
    divTotal.innerHTML = '';
    return;
  }
  let total = 0;
  let html = '';
  carrito.forEach((item, i) => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;
    html += `<div class="carrito-item">
      <span>${item.nombre} x${item.cantidad}</span>
      <span>$${subtotal.toFixed(2)}</span>
      <button onclick="eliminarItem(${item.producto_id})">❌</button>
    </div>`;
  });
  divItems.innerHTML = html;
  divTotal.innerHTML = `<strong>Total: $${total.toFixed(2)}</strong>`;
}

window.eliminarItem = async (productoId) => {
  try {
    const res = await fetch(`${API_URL}/carrito/eliminar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, producto_id: productoId })
    });
    const data = await res.json();
    if (data.success) {
      carrito = data.carrito;
      renderCarrito();
    }
  } catch (error) {
    alert('Error al eliminar');
  }
};

function mostrarResumen() {
  if (carrito.length === 0) return alert('Carrito vacío');
  let total = 0;
  let detalle = '';
  carrito.forEach(item => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;
    detalle += `<p>• ${item.nombre} x${item.cantidad} = $${subtotal.toFixed(2)}</p>`;
  });
  document.getElementById('resumen-detalle').innerHTML = detalle;
  document.getElementById('resumen-total').innerHTML = `<h3>Total: $${total.toFixed(2)}</h3>`;
  catalogoSection.classList.add('hidden');
  resumenSection.classList.remove('hidden');
}

function cancelarPedido() {
  carrito = [];
  renderCarrito();
  mostrarCatalogo();
}

function mostrarMetodosPago() {
  resumenSection.classList.add('hidden');
  pagoSection.classList.remove('hidden');
}

function mostrarCatalogo() {
  pagoSection.classList.add('hidden');
  resumenSection.classList.add('hidden');
  confirmacionSection.classList.add('hidden');
  misPedidosSection.classList.add('hidden');
  catalogoSection.classList.remove('hidden');
}

async function procesarPago(metodo) {
  if (!clienteNombre) {
    modalNombre.classList.remove('hidden');
    document.getElementById('btnGuardarNombre').onclick = () => {
      clienteNombre = document.getElementById('cliente-nombre').value.trim();
      if (clienteNombre) {
        localStorage.setItem('clienteNombre', clienteNombre);
        modalNombre.classList.add('hidden');
        enviarPedido(metodo);
      }
    };
    return;
  }
  await enviarPedido(metodo);
}

async function enviarPedido(metodo) {
  const items = carrito.map(({ producto_id, cantidad }) => ({ producto_id, cantidad }));
  try {
    const res = await fetch(`${API_URL}/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, clienteNombre, items, metodoPago: metodo })
    });
    const data = await res.json();
    if (data.success) {
      ultimoPedidoId = data.pedidoId;
      carrito = [];
      renderCarrito();
      pagoSection.classList.add('hidden');
      confirmacionSection.classList.remove('hidden');
      document.querySelector('.mensaje-confirmacion').innerHTML = `
        <h3>✅ Pedido #${data.pedidoId} creado</h3>
        <p>Método de pago: ${metodo}</p>
        <p>Tu pedido ha sido enviado al vendedor para aprobación.</p>
      `;
      iniciarPollingEstado();
    } else {
      alert(data.error || 'Error al crear pedido');
    }
  } catch (error) {
    alert('Error de conexión');
  }
}

async function mostrarMisPedidos() {
  catalogoSection.classList.add('hidden');
  misPedidosSection.classList.remove('hidden');
  try {
    const res = await fetch(`${API_URL}/pedidos/${sessionId}`);
    const pedidos = await res.json();
    const lista = document.getElementById('pedidos-lista');
    if (pedidos.length === 0) {
      lista.innerHTML = '<p>No tienes pedidos.</p>';
    } else {
      let html = '';
      pedidos.forEach(p => {
        let estadoEmoji = '';
        let estadoTexto = p.estado.replace(/_/g, ' ');
        if (p.estado === 'pendiente_aprobacion_dueño') estadoEmoji = '⏳';
        else if (p.estado === 'aprobado') estadoEmoji = '✅';
        else if (p.estado === 'rechazado') estadoEmoji = '❌';
        else if (p.estado === 'cancelado_por_cliente') estadoEmoji = '🚫';
        html += `<div class="pedido">
          <p><strong>#${p.id}</strong> - ${new Date(p.fecha_pedido).toLocaleDateString()}</p>
          <p>Total: $${parseFloat(p.total).toFixed(2)} | Estado: ${estadoEmoji} ${estadoTexto}</p>
          <p>Pago: ${p.metodo_pago || 'N/A'}</p>
          <hr>
        </div>`;
      });
      lista.innerHTML = html;
    }
  } catch (error) {
    document.getElementById('pedidos-lista').innerHTML = '<p>Error al cargar pedidos.</p>';
  }
}

function iniciarPollingEstado() {
  if (!ultimoPedidoId) return;
  const intervalo = setInterval(async () => {
    try {
      const res = await fetch(`${API_URL}/pedidos/${sessionId}`);
      const pedidos = await res.json();
      const pedido = pedidos.find(p => p.id === ultimoPedidoId);
      if (pedido && (pedido.estado === 'aprobado' || pedido.estado === 'rechazado')) {
        clearInterval(intervalo);
        alert(`Tu pedido #${pedido.id} ha sido ${pedido.estado === 'aprobado' ? 'APROBADO' : 'RECHAZADO'}`);
        ultimoPedidoId = null;
      }
    } catch (e) {}
  }, 5000);
}