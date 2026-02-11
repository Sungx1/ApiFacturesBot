// Configuración
const API_URL = 'https://tu-backend.onrender.com/api';  // Cambiar después del despliegue
// Para pruebas locales: const API_URL = 'http://localhost:3000/api';

// Gestión de sesión
let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
  sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('sessionId', sessionId);
}

// Estado global
let productos = [];
let carrito = [];

// Elementos DOM
const catalogoSection = document.getElementById('catalogo');
const carritoSection = document.getElementById('carrito');
const estadoSection = document.getElementById('estado-pedido');
const productosList = document.getElementById('productos-list');
const carritoItems = document.getElementById('carrito-items');
const totalCarrito = document.getElementById('total-carrito');
const checkoutForm = document.getElementById('checkout-form');
const seguirComprandoBtn = document.getElementById('seguir-comprando');
const mensajeEstado = document.getElementById('mensaje-estado');
const detallePedido = document.getElementById('detalle-pedido');
const accionesPedido = document.getElementById('acciones-pedido');

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  cargarProductos();
  verificarPedidoActivo();
});

// Cargar productos desde el backend
async function cargarProductos() {
  try {
    const response = await fetch(`${API_URL}/productos`);
    if (!response.ok) throw new Error('Error al cargar productos');
    productos = await response.json();
    renderizarProductos();
  } catch (error) {
    console.error('Error:', error);
    productosList.innerHTML = '<p style="color: red;">Error al cargar los productos. Intenta más tarde.</p>';
  }
}

// Renderizar catálogo
function renderizarProductos() {
  if (productos.length === 0) {
    productosList.innerHTML = '<p>No hay productos disponibles.</p>';
    return;
  }

  productosList.innerHTML = productos.map(producto => `
    <div class="producto-card">
      <h3>${producto.nombre}</h3>
      <div class="precio">$${producto.precio}</div>
      <div class="stock">Stock: ${producto.cantidad} unidades</div>
      <div class="detalles">${producto.detalles || 'Sin detalles'}</div>
      <div class="envio">${producto.tiene_envio ? '🚚 Con envío' : '📍 Retiro en local'}</div>
      <button 
        class="btn-agregar" 
        onclick="agregarAlCarrito(${producto.id})"
        ${producto.cantidad === 0 ? 'disabled' : ''}>
        ${producto.cantidad === 0 ? 'Sin stock' : 'Agregar al pedido'}
      </button>
    </div>
  `).join('');
}

// Agregar producto al carrito
window.agregarAlCarrito = function(productoId) {
  const producto = productos.find(p => p.id === productoId);
  if (!producto) return;

  const itemExistente = carrito.find(item => item.producto_id === productoId);
  
  if (itemExistente) {
    if (itemExistente.cantidad < producto.cantidad) {
      itemExistente.cantidad++;
    } else {
      alert('No hay suficiente stock');
      return;
    }
  } else {
    carrito.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad: 1,
      stock: producto.cantidad
    });
  }

  actualizarCarritoUI();
  mostrarCarrito();
};

// Actualizar vista del carrito
function actualizarCarritoUI() {
  if (carrito.length === 0) {
    carritoSection.style.display = 'none';
    catalogoSection.style.display = 'block';
    return;
  }

  carritoItems.innerHTML = carrito.map(item => `
    <div class="carrito-item">
      <div>
        <strong>${item.nombre}</strong><br>
        $${item.precio} x ${item.cantidad}
      </div>
      <div>
        <button onclick="modificarCantidad(${item.producto_id}, -1)">-</button>
        <span style="margin: 0 10px;">${item.cantidad}</span>
        <button onclick="modificarCantidad(${item.producto_id}, 1)">+</button>
        <button onclick="eliminarDelCarrito(${item.producto_id})" style="background-color: #dc3545; margin-left: 10px;">🗑️</button>
      </div>
    </div>
  `).join('');

  const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
  totalCarrito.textContent = total.toFixed(2);
}

// Modificar cantidad
window.modificarCantidad = function(productoId, delta) {
  const item = carrito.find(i => i.producto_id === productoId);
  if (!item) return;

  const producto = productos.find(p => p.id === productoId);
  const nuevaCantidad = item.cantidad + delta;

  if (nuevaCantidad <= 0) {
    eliminarDelCarrito(productoId);
  } else if (nuevaCantidad <= producto.cantidad) {
    item.cantidad = nuevaCantidad;
    actualizarCarritoUI();
  } else {
    alert('No hay suficiente stock');
  }
};

// Eliminar del carrito
window.eliminarDelCarrito = function(productoId) {
  carrito = carrito.filter(item => item.producto_id !== productoId);
  actualizarCarritoUI();
  if (carrito.length === 0) {
    mostrarCatalogo();
  }
};

// Mostrar carrito
function mostrarCarrito() {
  catalogoSection.style.display = 'none';
  carritoSection.style.display = 'block';
  estadoSection.style.display = 'none';
}

// Mostrar catálogo
function mostrarCatalogo() {
  catalogoSection.style.display = 'block';
  carritoSection.style.display = 'none';
  estadoSection.style.display = 'none';
}

// Seguir comprando
seguirComprandoBtn.addEventListener('click', mostrarCatalogo);

// Enviar pedido
checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const clienteNombre = document.getElementById('nombre').value.trim();
  if (!clienteNombre) {
    alert('Por favor ingresa tu nombre');
    return;
  }

  if (carrito.length === 0) {
    alert('El carrito está vacío');
    return;
  }

  const pedidoData = {
    sessionId,
    clienteNombre,
    items: carrito.map(item => ({
      producto_id: item.producto_id,
      cantidad: item.cantidad
    }))
  };

  try {
    const response = await fetch(`${API_URL}/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedidoData)
    });

    const data = await response.json();

    if (response.ok) {
      // Guardar pedidoId
      localStorage.setItem('ultimoPedidoId', data.pedidoId);
      // Vaciar carrito
      carrito = [];
      // Mostrar pantalla de confirmación
      mostrarConfirmacionPedido(data.pedidoId, clienteNombre);
    } else {
      alert('Error: ' + (data.error || 'No se pudo crear el pedido'));
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Error de conexión. Intenta más tarde.');
  }
});

// Mostrar pantalla de confirmación
function mostrarConfirmacionPedido(pedidoId, clienteNombre) {
  catalogoSection.style.display = 'none';
  carritoSection.style.display = 'none';
  estadoSection.style.display = 'block';

  mensajeEstado.innerHTML = `
    <div class="estado-info">
      <h3>📋 Revisa tu pedido</h3>
      <p>Por favor confirma que los datos son correctos.</p>
    </div>
  `;

  // Obtener detalles del pedido
  fetch(`${API_URL}/pedido/${sessionId}`)
    .then(res => res.json())
    .then(pedido => {
      let html = '<h4>Detalle del pedido:</h4><ul>';
      pedido.items.forEach(item => {
        html += `<li>${item.nombre} x${item.cantidad} = $${item.precio_unitario * item.cantidad}</li>`;
      });
      html += `</ul><p><strong>Total: $${pedido.total}</strong></p>`;
      detallePedido.innerHTML = html;

      accionesPedido.innerHTML = `
        <button class="btn-confirmar" onclick="confirmarPedido(${pedidoId})">✅ Confirmar pedido</button>
        <button class="btn-cancelar" onclick="cancelarPedido(${pedidoId})">❌ Cancelar</button>
      `;
    });
}

// Confirmar pedido
window.confirmarPedido = async function(pedidoId) {
  try {
    const response = await fetch(`${API_URL}/pedido/${pedidoId}/confirmar`, {
      method: 'POST'
    });
    const data = await response.json();

    if (response.ok) {
      mensajeEstado.innerHTML = `
        <div class="estado-exito">
          <h3>✅ Pedido enviado</h3>
          <p>Tu pedido ha sido enviado al vendedor. Espera la confirmación.</p>
        </div>
      `;
      detallePedido.style.display = 'none';
      accionesPedido.style.display = 'none';
      
      // Iniciar polling para ver estado
      iniciarPollingEstado(pedidoId);
    } else {
      alert('Error: ' + (data.error || 'No se pudo confirmar'));
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Error de conexión');
  }
};

// Cancelar pedido
window.cancelarPedido = async function(pedidoId) {
  try {
    const response = await fetch(`${API_URL}/pedido/${pedidoId}/cancelar`, {
      method: 'POST'
    });
    if (response.ok) {
      mensajeEstado.innerHTML = `
        <div class="estado-error">
          <h3>❌ Pedido cancelado</h3>
          <p>Has cancelado el pedido.</p>
        </div>
      `;
      detallePedido.style.display = 'none';
      accionesPedido.style.display = 'none';
      
      setTimeout(() => {
        mostrarCatalogo();
      }, 3000);
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

// Polling para verificar estado del pedido
function iniciarPollingEstado(pedidoId) {
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/pedido/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) {
          clearInterval(interval);
        }
        return;
      }
      
      const pedido = await response.json();
      
      if (pedido.id !== parseInt(pedidoId)) return;
      
      if (pedido.estado === 'aprobado') {
        clearInterval(interval);
        mostrarPedidoAprobado(pedido);
      } else if (pedido.estado === 'rechazado') {
        clearInterval(interval);
        mostrarPedidoRechazado(pedido);
      }
    } catch (error) {
      console.error('Error en polling:', error);
    }
  }, 3000);
}

// Mostrar pedido aprobado
function mostrarPedidoAprobado(pedido) {
  mensajeEstado.innerHTML = `
    <div class="estado-exito">
      <h3>🎉 ¡Pedido aprobado!</h3>
      <p>Tu pedido ha sido confirmado y será enviado pronto.</p>
    </div>
  `;
}

// Mostrar pedido rechazado
function mostrarPedidoRechazado(pedido) {
  mensajeEstado.innerHTML = `
    <div class="estado-error">
      <h3>❌ Pedido rechazado</h3>
      <p>El vendedor rechazó el pedido. Por favor contacta para más información.</p>
    </div>
  `;
}

// Verificar si hay pedido activo al cargar la página
async function verificarPedidoActivo() {
  try {
    const response = await fetch(`${API_URL}/pedido/${sessionId}`);
    if (response.ok) {
      const pedido = await response.json();
      if (['esperando_confirmacion_cliente', 'pendiente_aprobacion_dueño'].includes(pedido.estado)) {
        mostrarConfirmacionPedido(pedido.id, pedido.cliente_nombre);
        if (pedido.estado === 'pendiente_aprobacion_dueño') {
          iniciarPollingEstado(pedido.id);
        }
      }
    }
  } catch (error) {
    console.error('Error al verificar pedido activo:', error);
  }
}