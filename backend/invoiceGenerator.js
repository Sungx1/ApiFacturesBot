const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generateInvoice(orderData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const fileName = `factura-${orderData.orderId}.pdf`;
      const folderPath = path.join(__dirname, 'invoices');
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
      const filePath = path.join(folderPath, fileName);
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(20).text('FACTURA', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Número: ${orderData.orderId}`);
      doc.text(`Fecha: ${orderData.fecha || new Date().toLocaleString()}`);
      doc.text(`Cliente: ${orderData.cliente_nombre}`);
      doc.moveDown();
      doc.text('Productos:');
      orderData.items.forEach(item => {
        doc.text(`${item.nombre} x${item.cantidad} = $${(item.precio_unitario * item.cantidad).toFixed(2)}`);
      });
      doc.moveDown();
      doc.fontSize(14).text(`Total: $${orderData.total}`, { bold: true });
      doc.end();

      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = generateInvoice;