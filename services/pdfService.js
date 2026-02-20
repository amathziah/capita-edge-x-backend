import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

/**
 * PDF Generation Service
 * Creates professional invoice PDFs with logos, QR codes, and custom formatting
 */
class PDFService {
    /**
     * Generate invoice PDF
     * @param {Object} invoice - Invoice data
     * @param {Object} settings - Business settings
     * @param {string} outputPath - Path to save PDF
     */
    async generateInvoicePDF(invoice, settings = {}, outputPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const stream = fs.createWriteStream(outputPath);

                doc.pipe(stream);

                // Header with logo
                await this.addHeader(doc, settings);

                // Invoice title and number
                this.addInvoiceTitle(doc, invoice);

                // Business and customer details
                this.addBusinessDetails(doc, settings, invoice);

                // Invoice items table
                this.addItemsTable(doc, invoice);

                // Totals
                this.addTotals(doc, invoice);

                // Payment info and QR code
                await this.addPaymentInfo(doc, invoice, settings);

                // Footer
                this.addFooter(doc, settings);

                doc.end();

                stream.on('finish', () => resolve(outputPath));
                stream.on('error', reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Add header with logo
     */
    async addHeader(doc, settings) {
        const logoPath = settings.logoPath;

        if (logoPath && fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, 50, 45, { width: 80 });
            } catch (err) {
                console.error('Logo load error:', err);
            }
        }

        // Company name
        doc.fontSize(20)
            .font('Helvetica-Bold')
            .text(settings.businessName || 'Your Business', 150, 50);

        doc.fontSize(10)
            .font('Helvetica')
            .text(settings.address || '', 150, 75)
            .text(settings.phone || '', 150, 90)
            .text(settings.email || '', 150, 105);

        doc.moveDown(2);
    }

    /**
     * Add invoice title and number
     */
    addInvoiceTitle(doc, invoice) {
        doc.fontSize(24)
            .font('Helvetica-Bold')
            .fillColor('#4F46E5')
            .text('INVOICE', 50, 150);

        doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#000000')
            .text(`Invoice #: ${invoice.invoiceNumber}`, 400, 155)
            .text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, 400, 170)
            .text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`, 400, 185);

        doc.moveDown(2);
    }

    /**
     * Add business and customer details
     */
    addBusinessDetails(doc, settings, invoice) {
        const yPos = 220;

        // Bill To
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .text('BILL TO:', 50, yPos);

        doc.fontSize(10)
            .font('Helvetica')
            .text(invoice.buyer?.name || 'Customer', 50, yPos + 20)
            .text(invoice.buyer?.phone || '', 50, yPos + 35)
            .text(invoice.buyer?.email || '', 50, yPos + 50);

        // Ship To (if different)
        if (invoice.shipTo && invoice.shipTo.name) {
            doc.fontSize(12)
                .font('Helvetica-Bold')
                .text('SHIP TO:', 300, yPos);

            doc.fontSize(10)
                .font('Helvetica')
                .text(invoice.shipTo.name, 300, yPos + 20)
                .text(invoice.shipTo.address || '', 300, yPos + 35);
        }

        doc.moveDown(4);
    }

    /**
     * Add items table
     */
    addItemsTable(doc, invoice) {
        const tableTop = 320;
        const itemCodeX = 50;
        const descriptionX = 50;
        const quantityX = 300;
        const priceX = 350;
        const amountX = 450;

        // Table header
        doc.fontSize(10)
            .font('Helvetica-Bold')
            .fillColor('#4F46E5');

        this.drawTableRow(
            doc,
            tableTop,
            'Description',
            'Qty',
            'Price',
            'Amount'
        );

        // Header line
        doc.strokeColor('#4F46E5')
            .lineWidth(2)
            .moveTo(50, tableTop + 20)
            .lineTo(550, tableTop + 20)
            .stroke();

        // Table rows
        doc.font('Helvetica').fillColor('#000000');
        let yPos = tableTop + 30;

        invoice.items.forEach((item, index) => {
            if (yPos > 700) {
                doc.addPage();
                yPos = 50;
            }

            const amount = (item.quantity * item.price) - (item.discount || 0);

            this.drawTableRow(
                doc,
                yPos,
                item.description,
                `${item.quantity} ${item.unit || ''}`,
                `Rs. ${item.price.toFixed(2)}`,
                `Rs. ${amount.toFixed(2)}`
            );

            yPos += 25;
        });

        // Bottom line
        doc.strokeColor('#CCCCCC')
            .lineWidth(1)
            .moveTo(50, yPos)
            .lineTo(550, yPos)
            .stroke();

        return yPos + 10;
    }

    /**
     * Draw table row
     */
    drawTableRow(doc, y, col1, col2, col3, col4) {
        doc.fontSize(9)
            .text(col1, 50, y, { width: 250 })
            .text(col2, 300, y, { width: 50, align: 'center' })
            .text(col3, 350, y, { width: 100, align: 'right' })
            .text(col4, 450, y, { width: 100, align: 'right' });
    }

    /**
     * Add totals section
     */
    addTotals(doc, invoice) {
        const subtotal = invoice.subtotal || 0;
        const tax = invoice.tax || 0;
        const discount = invoice.discount || 0;
        const total = invoice.total || 0;

        let yPos = doc.y + 20;

        doc.fontSize(10).font('Helvetica');

        // Subtotal
        doc.text('Subtotal:', 350, yPos, { width: 100, align: 'right' })
            .text(`Rs. ${subtotal.toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });

        yPos += 20;

        // Discount
        if (discount > 0) {
            doc.text('Discount:', 350, yPos, { width: 100, align: 'right' })
                .text(`-Rs. ${discount.toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
            yPos += 20;
        }

        // Tax
        if (tax > 0) {
            const taxLabel = invoice.taxType || 'Tax';
            const taxRate = invoice.taxRate || 0;
            doc.text(`${taxLabel} (${taxRate}%):`, 350, yPos, { width: 100, align: 'right' })
                .text(`Rs. ${tax.toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });
            yPos += 20;
        }

        // Total line
        doc.strokeColor('#4F46E5')
            .lineWidth(2)
            .moveTo(350, yPos)
            .lineTo(550, yPos)
            .stroke();

        yPos += 10;

        // Total
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#4F46E5')
            .text('TOTAL:', 350, yPos, { width: 100, align: 'right' })
            .text(`Rs. ${total.toFixed(2)}`, 450, yPos, { width: 100, align: 'right' });

        doc.fillColor('#000000').font('Helvetica');
    }

    /**
     * Add payment info and QR code
     */
    async addPaymentInfo(doc, invoice, settings) {
        const yPos = doc.y + 40;

        // Payment instructions
        doc.fontSize(10)
            .font('Helvetica-Bold')
            .text('Payment Information:', 50, yPos);

        doc.fontSize(9)
            .font('Helvetica')
            .text(settings.paymentInstructions || 'Please make payment to the account details provided.', 50, yPos + 20, { width: 300 });

        // Bank details
        if (settings.bankDetails) {
            doc.text(settings.bankDetails, 50, yPos + 50, { width: 300 });
        }

        // QR Code for UPI payment
        if (settings.upiId) {
            try {
                const qrData = `upi://pay?pa=${settings.upiId}&pn=${encodeURIComponent(settings.businessName || 'Business')}&am=${invoice.total}&cu=INR`;
                const qrCodeDataUrl = await QRCode.toDataURL(qrData);
                const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');

                doc.image(qrBuffer, 400, yPos + 20, { width: 100 });
                doc.fontSize(8)
                    .text('Scan to Pay', 400, yPos + 130, { width: 100, align: 'center' });
            } catch (err) {
                console.error('QR Code generation error:', err);
            }
        }
    }

    /**
     * Add footer
     */
    addFooter(doc, settings) {
        const bottomY = 750;

        // Notes
        if (settings.invoiceNotes) {
            doc.fontSize(8)
                .font('Helvetica-Oblique')
                .text(settings.invoiceNotes, 50, bottomY - 50, { width: 500, align: 'left' });
        }

        // Footer line
        doc.strokeColor('#CCCCCC')
            .lineWidth(1)
            .moveTo(50, bottomY)
            .lineTo(550, bottomY)
            .stroke();

        // Footer text
        doc.fontSize(8)
            .font('Helvetica')
            .fillColor('#666666')
            .text(
                settings.footerText || 'Thank you for your business!',
                50,
                bottomY + 10,
                { align: 'center', width: 500 }
            );
    }

    /**
     * Generate temporary PDF path
     */
    getTempPDFPath(invoiceNumber) {
        const filename = `invoice_${invoiceNumber}_${Date.now()}.pdf`;
        // Use import.meta.url to get the directory of the current module
        const currentDir = path.dirname(new URL(import.meta.url).pathname);
        const tempDir = path.join(currentDir, '..', 'temp');

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        return path.join(tempDir, filename);
    }

    /**
     * Clean up temporary PDF
     */
    cleanupPDF(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error('PDF cleanup error:', err);
        }
    }
}

export default new PDFService();
