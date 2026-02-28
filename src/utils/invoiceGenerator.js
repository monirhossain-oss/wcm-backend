import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const createInvoice = (transaction, listing) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const fileName = `invoice-${transaction.invoiceNumber}.pdf`;
  const filePath = path.join('uploads/invoices', fileName);

  // ফোল্ডার না থাকলে তৈরি করবে
  if (!fs.existsSync('uploads/invoices')) {
    fs.mkdirSync('uploads/invoices', { recursive: true });
  }

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // --- ইনভয়েস ডিজাইন ---
  doc.fontSize(20).text(process.env.BUSINESS_NAME, { align: 'right' });
  doc.fontSize(10).text(process.env.BUSINESS_ADDRESS, { align: 'right' });
  doc.text(`VAT: ${process.env.BUSINESS_VAT_NUMBER}`, { align: 'right' });
  doc.moveDown();

  doc.fontSize(18).text('INVOICE', { underline: true });
  doc.moveDown();

  doc.fontSize(12).text(`Invoice Number: ${transaction.invoiceNumber}`);
  doc.text(`Date: ${new Date().toLocaleDateString()}`);
  doc.text(`Listing: ${listing.title}`);
  doc.moveDown();

  doc.text('---------------------------------------');
  doc.text(`Amount: ${transaction.amountPaid} ${transaction.currency.toUpperCase()}`);
  doc.text(`Exchange Rate (to EUR): ${transaction.fxRate}`);
  doc.text(`Total in EUR: ${transaction.amountInEUR.toFixed(2)}€`);
  doc.text(`VAT (19%): ${transaction.vatAmount.toFixed(2)}€`);
  doc.text('---------------------------------------');

  doc.moveDown();
  doc.fontSize(14).text(`Total Paid: ${transaction.amountInEUR.toFixed(2)}€`, { bold: true });

  doc.end();
  return filePath;
};
