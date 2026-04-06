import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

/**
 * PDF Generation Service
 * Creates professional invoice PDFs with logos, QR codes, and custom formatting
 */
class PDFService {
    getCurrencySymbol(settings = {}) {
        const currency = settings.currencySymbol || settings.currency || settings.currencyCode || 'INR';

        if (currency === 'INR' || currency === 'Rs.' || currency === '₹') {
            return 'Rs.';
        }

        return `${currency} `;
    }

    formatAmount(value, settings = {}) {
        const amount = Number(value || 0);
        return `${this.getCurrencySymbol(settings)}${amount.toFixed(2)}`;
    }

    formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('en-IN');
    }

    safeText(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    getBuyer(invoice = {}) {
        return invoice.buyer || invoice.customers || invoice.customer || {};
    }

    getItems(invoice = {}) {
        const items = invoice.items || invoice.items_data || [];
        return Array.isArray(items) ? items : [];
    }

    ensureSpace(doc, y, requiredHeight, onNewPage) {
        const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;

        if (y + requiredHeight <= bottomLimit) {
            return y;
        }

        doc.addPage();
        return onNewPage ? onNewPage() : doc.page.margins.top;
    }

    drawDivider(doc, y, color = '#E5E7EB') {
        doc.strokeColor(color)
            .lineWidth(1)
            .moveTo(doc.page.margins.left, y)
            .lineTo(doc.page.width - doc.page.margins.right, y)
            .stroke();
    }

    drawKeyValue(doc, label, value, x, y, width = 180) {
        doc.font('Helvetica-Bold')
            .fontSize(8)
            .fillColor('#6B7280')
            .text(label.toUpperCase(), x, y, { width });

        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(value || '-', x, y + 11, { width });

        return y + 28;
    }

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

                let y = await this.addHeader(doc, settings, invoice);
                y = this.addBusinessDetails(doc, settings, invoice, y);
                y = this.addItemsTable(doc, invoice, settings, y);
                y = this.addTotals(doc, invoice, settings, y);
                y = await this.addPaymentInfo(doc, invoice, settings, y);
                this.addFooter(doc, settings, invoice, y);

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
    async addHeader(doc, settings, invoice) {
        const logoPath = settings.logoPath;
        const leftX = doc.page.margins.left;
        const rightX = 360;
        let y = 48;

        if (logoPath && fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, leftX, y, { width: 64, height: 64, fit: [64, 64] });
            } catch (err) {
                console.error('Logo load error:', err);
            }
        }

        doc.fontSize(20)
            .font('Helvetica-Bold')
            .fillColor('#111827')
            .text(settings.businessName || invoice?.seller?.name || 'Your Business', 130, y + 2, { width: 200 });

        const companyLines = [
            this.safeText(settings.address),
            this.safeText(settings.phone),
            this.safeText(settings.email),
            settings.gstin ? `GSTIN: ${settings.gstin}` : '',
            settings.pan ? `PAN: ${settings.pan}` : '',
        ].filter(Boolean);

        doc.fontSize(9).font('Helvetica').fillColor('#4B5563');
        companyLines.forEach((line, index) => {
            doc.text(line, 130, y + 26 + (index * 13), { width: 220 });
        });

        doc.roundedRect(rightX, y, 185, 76, 10)
            .fillAndStroke('#F8FAFC', '#E2E8F0');

        doc.font('Helvetica-Bold')
            .fontSize(22)
            .fillColor('#0F172A')
            .text('INVOICE', rightX + 16, y + 14, { width: 120 });

        const status = this.safeText(invoice?.status || 'draft').replace(/_/g, ' ').toUpperCase();
        doc.roundedRect(rightX + 118, y + 14, 50, 18, 9)
            .fill('#111827');
        doc.font('Helvetica-Bold')
            .fontSize(7)
            .fillColor('#FFFFFF')
            .text(status, rightX + 118, y + 19, { width: 50, align: 'center' });

        this.drawKeyValue(doc, 'Invoice #', this.safeText(invoice?.invoiceNumber), rightX + 16, y + 40, 70);
        this.drawKeyValue(doc, 'Issued', this.formatDate(invoice?.date || invoice?.createdAt), rightX + 92, y + 40, 45);
        this.drawKeyValue(doc, 'Due', this.formatDate(invoice?.dueDate), rightX + 138, y + 40, 31);

        const nextY = 142;
        this.drawDivider(doc, nextY);
        return nextY + 18;
    }

    /**
     * Add business and customer details
     */
    addBusinessDetails(doc, settings, invoice, startY) {
        const buyer = this.getBuyer(invoice);
        let y = startY;
        const leftX = doc.page.margins.left;
        const rightX = 315;
        const columnWidth = 225;

        doc.fontSize(9)
            .font('Helvetica-Bold')
            .fillColor('#6B7280')
            .text('BILL FROM', leftX, y)
            .text('BILL TO', rightX, y);

        const sellerLines = [
            settings.businessName || invoice?.seller?.name || 'Your Business',
            settings.address,
            settings.email,
            settings.phone,
            settings.gstin ? `GSTIN: ${settings.gstin}` : '',
            settings.pan ? `PAN: ${settings.pan}` : '',
        ].filter(Boolean);

        const buyerLines = [
            buyer?.name || 'Customer',
            buyer?.address || buyer?.addressLine1 || '',
            buyer?.addressLine2 || '',
            [buyer?.city, buyer?.state, buyer?.pincode].filter(Boolean).join(', '),
            buyer?.email || '',
            buyer?.phone || '',
            buyer?.gstin ? `GSTIN: ${buyer.gstin}` : '',
            buyer?.pan ? `PAN: ${buyer.pan}` : '',
        ].filter(Boolean);

        doc.font('Helvetica').fontSize(10).fillColor('#111827');
        const leftHeight = doc.heightOfString(sellerLines.join('\n'), { width: columnWidth, lineGap: 2 });
        const rightHeight = doc.heightOfString(buyerLines.join('\n'), { width: columnWidth, lineGap: 2 });

        doc.text(sellerLines.join('\n'), leftX, y + 16, { width: columnWidth, lineGap: 2 });
        doc.text(buyerLines.join('\n'), rightX, y + 16, { width: columnWidth, lineGap: 2 });

        let nextY = y + 26 + Math.max(leftHeight, rightHeight);
        const complianceBits = [
            invoice?.placeOfSupply ? `Place of Supply: ${invoice.placeOfSupply}` : '',
            invoice?.projectName ? `Project: ${invoice.projectName}` : '',
            invoice?.reverseCharge ? 'Reverse Charge: Yes' : '',
        ].filter(Boolean);

        if (complianceBits.length > 0) {
            doc.font('Helvetica')
                .fontSize(9)
                .fillColor('#4B5563')
                .text(complianceBits.join('    '), leftX, nextY + 8, { width: 500 });
            nextY += 24;
        }

        this.drawDivider(doc, nextY + 10);
        return nextY + 24;
    }

    /**
     * Add items table
     */
    addItemsTable(doc, invoice, settings, startY) {
        const items = this.getItems(invoice);
        const drawHeader = (headerY) => {
            doc.roundedRect(50, headerY, 495, 24, 6)
                .fillAndStroke('#F8FAFC', '#E2E8F0');
            doc.font('Helvetica-Bold')
                .fontSize(8)
                .fillColor('#475569')
                .text('DESCRIPTION', 60, headerY + 8, { width: 235 })
                .text('QTY', 300, headerY + 8, { width: 50, align: 'center' })
                .text('RATE', 360, headerY + 8, { width: 85, align: 'right' })
                .text('AMOUNT', 450, headerY + 8, { width: 85, align: 'right' });
            return headerY + 32;
        };

        let y = drawHeader(startY);

        if (items.length === 0) {
            doc.font('Helvetica')
                .fontSize(10)
                .fillColor('#6B7280')
                .text('No line items added.', 60, y + 6);
            this.drawDivider(doc, y + 24);
            return y + 36;
        }

        for (const item of items) {
            const quantity = Number(item.quantity || 0);
            const price = Number(item.price || 0);
            const discount = Number(item.discount || item.discountAmount || 0);
            const amount = Math.max((quantity * price) - discount, 0);
            const itemCode = item.hsnCode || item.hsn_code || item.sacCode || item.sac_code;
            const descriptionLines = [
                this.safeText(item.description || 'Item'),
                itemCode ? `${item.hsnCode || item.hsn_code ? 'HSN' : 'SAC'}: ${itemCode}` : '',
            ].filter(Boolean).join('\n');

            const rowHeight = Math.max(
                24,
                doc.heightOfString(descriptionLines, { width: 235, lineGap: 2 }) + 8
            );

            y = this.ensureSpace(doc, y, rowHeight + 10, () => drawHeader(50));

            doc.font('Helvetica')
                .fontSize(10)
                .fillColor('#111827')
                .text(descriptionLines, 60, y, { width: 235, lineGap: 2 })
                .text(`${quantity}${item.unit ? ` ${item.unit}` : ''}`, 300, y, { width: 50, align: 'center' })
                .text(this.formatAmount(price, settings), 360, y, { width: 85, align: 'right' })
                .text(this.formatAmount(amount, settings), 450, y, { width: 85, align: 'right' });

            doc.strokeColor('#E5E7EB')
                .lineWidth(1)
                .moveTo(50, y + rowHeight)
                .lineTo(545, y + rowHeight)
                .stroke();

            y += rowHeight + 8;
        }

        return y + 8;
    }

    /**
     * Add totals section
     */
    addTotals(doc, invoice, settings, startY) {
        const subtotal = Number(invoice.subtotal || 0);
        const discount = Number(invoice.discountAmount || invoice.discount || 0);
        const shipping = Number(invoice.shipping || 0);
        const taxAmount = Number(invoice.taxAmount || invoice.tax || 0);
        const total = Number(invoice.total || 0);
        const summaryRows = [
            ['Subtotal', this.formatAmount(subtotal, settings)],
        ];

        if (discount > 0) summaryRows.push(['Discount', `-${this.formatAmount(discount, settings)}`]);
        if (shipping > 0) summaryRows.push(['Shipping', this.formatAmount(shipping, settings)]);

        if (invoice.isGstRegistered !== false && (invoice.gstType !== 'not_applicable' || taxAmount > 0) && taxAmount > 0) {
            if (invoice.gstType === 'igst' || Number(invoice.igstAmount || 0) > 0) {
                summaryRows.push([`IGST @ ${Number(invoice.taxRate || 0)}%`, this.formatAmount(invoice.igstAmount || taxAmount, settings)]);
            } else {
                summaryRows.push([`CGST @ ${Number(invoice.taxRate || 0) / 2}%`, this.formatAmount(invoice.cgstAmount || taxAmount / 2, settings)]);
                summaryRows.push([`SGST @ ${Number(invoice.taxRate || 0) / 2}%`, this.formatAmount(invoice.sgstAmount || taxAmount / 2, settings)]);
            }
        }

        if (invoice.tdsApplicable && Number(invoice.tdsAmount || 0) > 0) {
            summaryRows.push([`TDS @ ${Number(invoice.tdsRate || 10)}%`, `-${this.formatAmount(invoice.tdsAmount, settings)}`]);
            summaryRows.push(['Net Receivable', this.formatAmount(invoice.netReceivable || (total - Number(invoice.tdsAmount || 0)), settings)]);
        }

        let y = this.ensureSpace(doc, startY, (summaryRows.length + 3) * 18, () => 50);
        const labelX = 345;
        const valueX = 450;

        doc.font('Helvetica').fontSize(10).fillColor('#374151');
        summaryRows.forEach(([label, value]) => {
            doc.text(label, labelX, y, { width: 90, align: 'right' });
            doc.text(value, valueX, y, { width: 85, align: 'right' });
            y += 18;
        });

        doc.strokeColor('#111827')
            .lineWidth(1.5)
            .moveTo(labelX, y + 2)
            .lineTo(535, y + 2)
            .stroke();

        y += 10;

        doc.font('Helvetica-Bold')
            .fontSize(12)
            .fillColor('#111827')
            .text('Total', labelX, y, { width: 90, align: 'right' })
            .text(this.formatAmount(total, settings), valueX, y, { width: 85, align: 'right' });

        return y + 28;
    }

    /**
     * Add payment info and QR code
     */
    async addPaymentInfo(doc, invoice, settings, startY) {
        const notes = [settings.paymentInstructions, settings.bankDetails, settings.invoiceNotes]
            .filter(Boolean)
            .join('\n\n');
        const hasQr = Boolean(settings.upiId);
        const blockHeight = Math.max(notes ? doc.heightOfString(notes, { width: 310, lineGap: 3 }) + 42 : 0, hasQr ? 140 : 0, 100);
        let y = this.ensureSpace(doc, startY, blockHeight + 16, () => 50);

        doc.roundedRect(50, y, 495, blockHeight, 8)
            .fillAndStroke('#F8FAFC', '#E2E8F0');

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#111827')
            .text('Payment Details', 64, y + 14);

        doc.font('Helvetica')
            .fontSize(9)
            .fillColor('#475569')
            .text(
                notes || 'Please make payment by the due date using the details shared by the seller.',
                64,
                y + 32,
                { width: hasQr ? 305 : 455, lineGap: 3 }
            );

        if (hasQr) {
            try {
                const qrData = `upi://pay?pa=${settings.upiId}&pn=${encodeURIComponent(settings.businessName || 'Business')}&am=${Number(invoice.total || 0).toFixed(2)}&cu=INR`;
                const qrCodeDataUrl = await QRCode.toDataURL(qrData, { margin: 0, width: 120 });
                const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');

                doc.image(qrBuffer, 412, y + 18, { width: 95, height: 95 });
                doc.font('Helvetica-Bold')
                    .fontSize(8)
                    .fillColor('#334155')
                    .text('Scan to Pay', 402, y + 118, { width: 115, align: 'center' });
            } catch (err) {
                console.error('QR Code generation error:', err);
            }
        }

        return y + blockHeight + 18;
    }

    /**
     * Add footer
     */
    addFooter(doc, settings, invoice = {}, startY = 0) {
        const requiredHeight = invoice?.seller?.includeSignature ? 74 : 28;
        let y = this.ensureSpace(doc, startY, requiredHeight + 20, () => 50);

        if (invoice?.seller?.includeSignature) {
            const signatureName = invoice?.seller?.signatureName || invoice?.seller?.name || 'Authorised Signatory';
            doc.fontSize(14)
                .font('Helvetica-Oblique')
                .fillColor('#444444')
                .text(signatureName, 390, y, { width: 140, align: 'center' });

            doc.strokeColor('#999999')
                .lineWidth(1)
                .moveTo(400, y + 32)
                .lineTo(520, y + 32)
                .stroke();

            doc.fontSize(8)
                .font('Helvetica')
                .fillColor('#666666')
                .text('Authorised Signature', 390, y + 38, { width: 140, align: 'center' });

            y += 68;
        }

        this.drawDivider(doc, y);
        doc.fontSize(8)
            .font('Helvetica')
            .fillColor('#666666')
            .text(
                settings.footerText || 'Thank you for your business!',
                50,
                y + 10,
                { align: 'center', width: 500 }
            );
    }

    /**
     * Generate payment receipt PDF
     */
    async generateReceiptPDF(payment, invoice, settings = {}, outputPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const stream = fs.createWriteStream(outputPath);

                doc.pipe(stream);

                // Header with logo
                await this.addHeader(doc, settings);

                // Title
                doc.fontSize(24)
                    .font('Helvetica-Bold')
                    .fillColor('#0D9488') // Teal-600
                    .text('PAYMENT RECEIPT', 50, 150);

                doc.fontSize(10)
                    .font('Helvetica')
                    .fillColor('#000000')
                    .text(`Receipt #: REC-${payment.id.split('-')[0].toUpperCase()}`, 400, 155)
                    .text(`Date: ${new Date(payment.date || payment.createdAt).toLocaleDateString()}`, 400, 170);

                doc.moveDown(2);

                // Payment Details
                doc.fontSize(12)
                    .font('Helvetica-Bold')
                    .text('Payment Details', 50, 220);

                doc.fontSize(10)
                    .font('Helvetica')
                    .text(`Linked Invoice: ${invoice.invoiceNumber}`, 50, 240)
                    .text(`Payment Method: ${payment.method}`, 50, 255)
                    .text(`Status: ${payment.status || 'Completed'}`, 50, 270);

                // Amount Box
                doc.rect(400, 220, 150, 60)
                    .fillAndStroke('#F0FDFA', '#B2F5EA');

                doc.fontSize(10)
                    .font('Helvetica-Bold')
                    .fillColor('#0D9488')
                    .text('AMOUNT PAID', 410, 230);

                doc.fontSize(16)
                    .font('Helvetica-Bold')
                    .text(`Rs. ${Number(payment.amount).toFixed(2)}`, 410, 250);

                doc.fillColor('#000000');
                doc.moveDown(4);

                // Invoice Summary
                doc.fontSize(12)
                    .font('Helvetica-Bold')
                    .text('Invoice Summary', 50, 320);

                doc.fontSize(10)
                    .font('Helvetica')
                    .text(`Invoice Total: Rs. ${Number(invoice.total).toFixed(2)}`, 50, 340);

                // Final balance (simple calculation)
                const balance = Number(invoice.total) - Number(payment.amount);
                if (balance > 0) {
                    doc.text(`Remaining Balance: Rs. ${balance.toFixed(2)}`, 50, 355);
                } else {
                    doc.font('Helvetica-Bold').fillColor('#059669')
                        .text('INVOICE FULLY PAID', 50, 355);
                }

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
     * Generate temporary PDF path
     */
    getTempPDFPath(invoiceNumber) {
        const filename = `invoice_${invoiceNumber}_${Date.now()}.pdf`;
        return this._getTempPath(filename);
    }

    /**
     * Generate temporary Receipt path
     */
    getTempReceiptPath(paymentId) {
        const filename = `receipt_${paymentId}_${Date.now()}.pdf`;
        return this._getTempPath(filename);
    }

    _getTempPath(filename) {
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
