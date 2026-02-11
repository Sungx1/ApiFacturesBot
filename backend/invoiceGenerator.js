// backend/invoiceGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generateInvoice(pedido) {
  return new Promise((resolve, reject) => {
    try {
      // Crear carpeta invoices si no existe
      const invoicesDir = path.join(__dirname, 'invoices');
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir);
      }

      const doc = new PDFDocument({ margin: 50 });
      const fileName = `factura-${pedido.id}.pdf`;
      const filePath = path.join(invoicesDir, fileName);
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Cabecera
      doc.fontSize(20).text('FACTURA', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Número de pedido: ${pedido.id}`);
      doc.text(`Fecha: ${new Date().toLocaleDateString()}`);
      doc.text(`Cliente: ${pedido.cliente_nombre}`);
      doc.moveDown();
      
      // Tabla de productos
      doc.fontSize(14).text('Productos:', { underline: true });
      doc.moveDown(0.5);
      
      let y = doc.y;
      doc.fontSize(10);
      doc.text('Producto', 50, y, { width: 200 });
      doc.text('Cantidad', 250, y, { width: 80 });
      doc.text('Precio unit.', 330, y, { width: 80 });
      doc.text('Subtotal', 410, y, { width: 80 });
      
      y += 20;
      pedido.items.forEach(item => {
        doc.text(item.nombre, 50, y, { width: 200 });
        doc.text(item.cantidad.toString(), 250, y, { width: 80 });
        doc.text(`$${item.precio_unitario}`, 330, y, { width: 80 });
        doc.text(`$${item.precio_unitario * item.cantidad}`, 410, y, { width: 80 });
        y += 20;
      });
      
      doc.moveDown();
      doc.fontSize(12).text(`Total: $${pedido.total}`, { align: 'right' });
      
      doc.end();
      
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = generateInvoice;