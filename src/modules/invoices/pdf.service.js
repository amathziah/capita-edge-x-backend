import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

/**
 * PDF Generation Service
 * Creates professional invoice PDFs with logos and custom formatting
 */
class PDFService {
    getTheme(type) {
        switch (type) {
            case 'subscription':
                return {
                    primary: '#4F46E5',
                    primarySoft: '#EEF2FF',
                    accent: '#312E81',
                    text: '#111827',
                    muted: '#6B7280',
                    border: '#C7D2FE',
                };
            case 'ecommerce':
                return {
                    primary: '#D97706',
                    primarySoft: '#FFFBEB',
                    accent: '#92400E',
                    text: '#111827',
                    muted: '#6B7280',
                    border: '#FCD34D',
                };
            case 'services_firm':
            case 'ca_firm':
                return {
                    primary: '#0F766E',
                    primarySoft: '#F0FDFA',
                    accent: '#134E4A',
                    text: '#111827',
                    muted: '#6B7280',
                    border: '#99F6E4',
                };
            case 'solopreneur':
            default:
                return {
                    primary: '#059669',
                    primarySoft: '#ECFDF5',
                    accent: '#065F46',
                    text: '#111827',
                    muted: '#6B7280',
                    border: '#A7F3D0',
                };
        }
    }

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

    getSeller(invoice = {}, settings = {}) {
        return {
            name: invoice?.seller?.name || settings.owner_name || settings.businessName || 'Your Business',
            phone: invoice?.seller?.phone || settings.phone || '',
            email: invoice?.seller?.email || settings.email || '',
            address: invoice?.seller?.address || settings.address || '',
            taxId: invoice?.seller?.taxId || settings.companyTaxId || settings.gstin || '',
            upiId: invoice?.seller?.upiId || settings.upiId || '',
            bankName: invoice?.seller?.bankName || settings.bankName || '',
            accountNumber: invoice?.seller?.accountNumber || settings.bankAccountNumber || '',
            ifscCode: invoice?.seller?.ifscCode || settings.bankIfsc || '',
            terms: invoice?.seller?.terms || settings.paymentInstructions || '',
            signatureName: invoice?.seller?.signatureName || settings.owner_name || settings.businessName || '',
            includeSignature: invoice?.seller?.includeSignature ?? Boolean(settings.owner_name || settings.businessName),
            paymentQrPath: settings.paymentQrPath || '',
        };
    }

    getBuyer(invoice = {}) {
        return invoice.buyer || invoice.customers || invoice.customer || {};
    }

    getItems(invoice = {}) {
        const items = invoice.items || invoice.items_data || [];
        return Array.isArray(items) ? items : [];
    }

    getLineAmount(item = {}) {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);
        const discountPercent = Number(item.discount_percent ?? item.discountPercent ?? item.discount ?? 0);
        const gross = quantity * price;
        return Math.max(gross - (gross * discountPercent) / 100, 0);
    }

    getDocumentTitle(invoice = {}) {
        const explicitType = this.safeText(invoice.type).toLowerCase();

        if (explicitType === 'bill_of_supply') return 'BILL OF SUPPLY';
        if (explicitType === 'credit_note') return 'CREDIT NOTE';
        if (explicitType === 'debit_note') return 'DEBIT NOTE';
        if (explicitType === 'delivery_challan') return 'DELIVERY CHALLAN';

        return invoice.isGstRegistered === false ? 'BILL OF SUPPLY' : 'INVOICE';
    }

    getPayableAmount(invoice = {}) {
        if (invoice.tdsApplicable && Number(invoice.netReceivable || 0) > 0) {
            return Number(invoice.netReceivable || 0);
        }
        return Number(invoice.total || 0);
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
                y = this.addNotesAndTerms(doc, invoice, settings, y);
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
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const seller = this.getSeller(invoice, settings);
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
            .text(seller.name, 130, y + 2, { width: 200 });

        const companyLines = [
            this.safeText(seller.address),
            this.safeText(seller.phone),
            this.safeText(seller.email),
            seller.taxId ? `GSTIN: ${seller.taxId}` : '',
            settings.pan ? `PAN: ${settings.pan}` : '',
        ].filter(Boolean);

        doc.fontSize(9).font('Helvetica').fillColor('#4B5563');
        companyLines.forEach((line, index) => {
            doc.text(line, 130, y + 26 + (index * 13), { width: 220 });
        });

        doc.roundedRect(rightX, y, 185, 76, 10)
            .fillAndStroke(theme.primarySoft, theme.border);

        doc.font('Helvetica-Bold')
            .fontSize(22)
            .fillColor(theme.accent)
            .text(this.getDocumentTitle(invoice), rightX + 16, y + 14, { width: 150 });

        const status = this.safeText(invoice?.status || 'draft').replace(/_/g, ' ').toUpperCase();
        doc.roundedRect(rightX + 118, y + 14, 50, 18, 9)
            .fill(theme.primary);
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
        const seller = this.getSeller(invoice, settings);
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        let y = startY;
        const leftX = doc.page.margins.left;
        const rightX = 315;
        const columnWidth = 225;

        doc.fontSize(9)
            .font('Helvetica-Bold')
            .fillColor(theme.muted)
            .text('BILL FROM', leftX, y)
            .text('BILL TO', rightX, y);

        const sellerLines = [
            seller.name,
            seller.address,
            seller.email,
            seller.phone,
            seller.taxId ? `GSTIN: ${seller.taxId}` : '',
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
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const drawHeader = (headerY) => {
            doc.roundedRect(50, headerY, 495, 24, 6)
                .fillAndStroke(theme.primarySoft, theme.border);
            doc.font('Helvetica-Bold')
                .fontSize(8)
                .fillColor(theme.accent)
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
            const amount = this.getLineAmount(item);
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
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
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
            .fillColor(theme.accent)
            .text('Total', labelX, y, { width: 90, align: 'right' })
            .text(this.formatAmount(total, settings), valueX, y, { width: 85, align: 'right' });

        return y + 28;
    }

    /**
     * Add payment info and QR code
     */
    async addPaymentInfo(doc, invoice, settings, startY) {
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const seller = this.getSeller(invoice, settings);
        const paymentLines = [
            seller.upiId ? `UPI: ${seller.upiId}` : '',
            seller.bankName ? `Bank: ${seller.bankName}` : '',
            seller.accountNumber ? `A/C: ${seller.accountNumber}` : '',
            seller.ifscCode ? `IFSC: ${seller.ifscCode}` : '',
            !seller.bankName && settings.bankDetails ? settings.bankDetails : '',
        ].filter(Boolean);
        const paymentBody = paymentLines.join('\n');
        const hasQr = Boolean(seller.paymentQrPath || seller.upiId);
        const blockHeight = Math.max(paymentBody ? doc.heightOfString(paymentBody, { width: 310, lineGap: 3 }) + 42 : 0, hasQr ? 140 : 0, 100);
        let y = this.ensureSpace(doc, startY, blockHeight + 16, () => 50);

        doc.roundedRect(50, y, 495, blockHeight, 8)
            .fillAndStroke(theme.primarySoft, theme.border);

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#111827')
            .text('Payment Details', 64, y + 14);

        doc.font('Helvetica')
            .fontSize(9)
            .fillColor('#475569')
            .text(
                paymentBody || 'Please make payment by the due date using the details shared by the seller.',
                64,
                y + 32,
                { width: hasQr ? 305 : 455, lineGap: 3 }
            );

        if (hasQr) {
            try {
                if (seller.paymentQrPath && fs.existsSync(seller.paymentQrPath)) {
                    doc.image(seller.paymentQrPath, 412, y + 18, { width: 95, height: 95, fit: [95, 95] });
                } else if (seller.upiId) {
                    const payableAmount = this.getPayableAmount(invoice);
                    const qrData = `upi://pay?pa=${seller.upiId}&pn=${encodeURIComponent(seller.name || settings.businessName || 'Business')}&am=${payableAmount.toFixed(2)}&cu=INR`;
                    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { margin: 0, width: 120 });
                    const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
                    doc.image(qrBuffer, 412, y + 18, { width: 95, height: 95 });
                }
                doc.font('Helvetica-Bold')
                    .fontSize(8)
                    .fillColor('#334155')
                    .text('Scan to Pay', 402, y + 118, { width: 115, align: 'center' });
            } catch (err) {
                console.error('Payment QR render error:', err);
            }
        }

        return y + blockHeight + 18;
    }

    addNotesAndTerms(doc, invoice, settings, startY) {
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const seller = this.getSeller(invoice, settings);
        const blocks = [
            {
                title: 'Notes',
                body: this.safeText(invoice?.notes || settings?.invoiceNotes),
            },
            {
                title: 'Terms & Conditions',
                body: this.safeText(seller.terms),
            },
        ].filter((block) => block.body);

        let y = startY;

        for (const block of blocks) {
            const bodyHeight = doc.heightOfString(block.body, { width: 495, lineGap: 3 });
            y = this.ensureSpace(doc, y, bodyHeight + 34, () => 50);

            doc.font('Helvetica-Bold')
                .fontSize(9)
                .fillColor(theme.muted)
                .text(block.title.toUpperCase(), 50, y, { width: 495 });

            doc.font('Helvetica')
                .fontSize(9)
                .fillColor('#475569')
                .text(block.body, 50, y + 14, { width: 495, lineGap: 3 });

            y += bodyHeight + 28;
        }

        return y;
    }

    /**
     * Add footer
     */
    addFooter(doc, settings, invoice = {}, startY = 0) {
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const seller = this.getSeller(invoice, settings);
        const requiredHeight = seller.includeSignature ? 74 : 28;
        let y = this.ensureSpace(doc, startY, requiredHeight + 20, () => 50);

        if (seller.includeSignature) {
            const signatureName = seller.signatureName || seller.name || 'Authorised Signatory';
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
            .fillColor(theme.muted)
            .text(
                settings.footerText || 'Thank you for your business!',
                50,
                y + 10,
                { align: 'center', width: 500 }
            );
    }

    /**
     * Generate payment receipt PDF — fully self-contained, no addHeader reuse
     */
    async generateReceiptPDF(payment, invoice, settings = {}, outputPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const stream = fs.createWriteStream(outputPath);
                doc.pipe(stream);

                const L = doc.page.margins.left;   // 50
                const R = doc.page.width - doc.page.margins.right; // 545
                const FULL_W = R - L;               // 495
                const theme = this.getTheme(invoice?.persona || settings?.businessType);
                const seller = this.getSeller(invoice, settings);
                const buyer = this.getBuyer(invoice);
                const logoPath = settings.logoPath;

                // ── 1. RECEIPT HEADER ─────────────────────────────────────────
                let y = 48;

                // Logo (left)
                if (logoPath && fs.existsSync(logoPath)) {
                    try {
                        doc.image(logoPath, L, y, { fit: [56, 56] });
                    } catch (_) {}
                }

                const nameX = logoPath && fs.existsSync(logoPath) ? L + 68 : L;
                const nameW = 230;

                // Business name
                doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
                    .text(seller.name || 'Business', nameX, y, { width: nameW });

                // Business sub-details
                const sellerLines = [
                    seller.address,
                    seller.phone,
                    seller.email,
                    seller.taxId ? `GSTIN: ${seller.taxId}` : '',
                    settings.pan ? `PAN: ${settings.pan}` : '',
                ].filter(Boolean);

                doc.font('Helvetica').fontSize(8.5).fillColor('#4B5563');
                sellerLines.forEach((line, i) => {
                    doc.text(line, nameX, y + 22 + i * 12, { width: nameW });
                });

                const leftColBottom = y + 22 + sellerLines.length * 12;

                // Receipt title box (right)
                const boxX = 340;
                const boxW = R - boxX;
                const receiptNum = `REC-${payment.id.split('-')[0].toUpperCase()}`;
                const receiptDate = this.formatDate(payment.date || payment.createdAt);
                const paymentDate = this.formatDate(payment.date || payment.createdAt);

                doc.roundedRect(boxX, y, boxW, 80, 8)
                    .fillAndStroke(theme.primarySoft, theme.border);

                doc.font('Helvetica-Bold').fontSize(14).fillColor(theme.accent)
                    .text('PAYMENT RECEIPT', boxX + 10, y + 10, { width: boxW - 20, align: 'center' });

                doc.font('Helvetica').fontSize(8.5).fillColor(theme.muted)
                    .text('Receipt No', boxX + 12, y + 36, { width: 60 });
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
                    .text(receiptNum, boxX + 12, y + 47, { width: boxW - 24 });

                doc.font('Helvetica').fontSize(8.5).fillColor(theme.muted)
                    .text('Date', boxX + 12, y + 60, { width: 60 });
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
                    .text(paymentDate, boxX + 12, y + 71, { width: boxW - 24 });

                const rightColBottom = y + 86;

                // Advance y past both columns
                y = Math.max(leftColBottom, rightColBottom) + 14;
                this.drawDivider(doc, y, theme.border);
                y += 16;

                // ── 2. RECEIVED FROM + AMOUNT PAID ────────────────────────────
                const customerLines = [
                    buyer?.name || 'Customer',
                    buyer?.address || buyer?.addressLine1 || '',
                    buyer?.addressLine2 || '',
                    [buyer?.city, buyer?.state, buyer?.pincode].filter(Boolean).join(', '),
                    buyer?.email || '',
                    buyer?.phone || '',
                    buyer?.gstin ? `GSTIN: ${buyer.gstin}` : '',
                ].filter(Boolean);

                const customerText = customerLines.join('\n');
                // Measure BEFORE rendering
                const customerTextH = doc.heightOfString(customerText, { width: 240, lineGap: 2 });
                const sectionH = Math.max(customerTextH + 22, 80);

                // Left: RECEIVED FROM
                doc.font('Helvetica-Bold').fontSize(8).fillColor(theme.muted)
                    .text('RECEIVED FROM', L, y);
                doc.font('Helvetica').fontSize(10).fillColor('#111827')
                    .text(customerText, L, y + 14, { width: 240, lineGap: 2 });

                // Right: AMOUNT PAID box — fixed 80px tall, right-aligned
                const amtBoxX = 360;
                const amtBoxW = R - amtBoxX;
                doc.roundedRect(amtBoxX, y, amtBoxW, 80, 8)
                    .fillAndStroke('#F0FDFA', '#99F6E4');
                doc.font('Helvetica-Bold').fontSize(8).fillColor('#0D9488')
                    .text('AMOUNT PAID', amtBoxX + 8, y + 10, { width: amtBoxW - 16, align: 'center' });
                doc.font('Helvetica-Bold').fontSize(20).fillColor('#065F46')
                    .text(this.formatAmount(payment.amount, settings), amtBoxX + 8, y + 28, { width: amtBoxW - 16, align: 'center' });

                y += sectionH + 12;
                this.drawDivider(doc, y, theme.border);
                y += 16;

                // ── 3. PAYMENT DETAILS ────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                    .text('Payment Details', L, y);
                y += 18;

                const methodRaw = payment.payment_mode || payment.method || 'Other';
                const methodDisplay = methodRaw.toUpperCase();

                const detailRows = [
                    ['Linked Invoice', invoice.invoiceNumber || '-'],
                    ['Payment Method', methodDisplay],
                    ['Payment Date', receiptDate],
                    ['Payment Status', (payment.status || 'Completed').toUpperCase()],
                ];
                if (payment.reference_number) detailRows.push(['Reference No.', payment.reference_number]);
                if (payment.upi_transaction_id) detailRows.push(['UPI Transaction ID', payment.upi_transaction_id]);
                if (payment.notes) detailRows.push(['Notes', payment.notes]);

                const colLabelW = 150;
                const colValX = L + colLabelW + 12;
                const colValW = FULL_W - colLabelW - 12;

                detailRows.forEach(([label, value]) => {
                    // Measure value height (notes can wrap)
                    const valH = doc.heightOfString(String(value), { width: colValW });
                    const rowH = Math.max(valH, 14) + 6;

                    y = this.ensureSpace(doc, y, rowH + 4, () => L + 50);

                    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#6B7280')
                        .text(label, L, y, { width: colLabelW });
                    doc.font('Helvetica').fontSize(9.5).fillColor('#111827')
                        .text(String(value), colValX, y, { width: colValW });

                    y += rowH;
                });

                y += 8;
                this.drawDivider(doc, y, theme.border);
                y += 16;

                // ── 4. INVOICE SUMMARY ────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                    .text('Invoice Summary', L, y);
                y += 18;

                const invoiceTotal = Number(invoice.total || 0);
                const totalPaid = Number(invoice.amount_paid || payment.amount || 0);
                const balanceDue = Math.max(invoiceTotal - totalPaid, 0);

                const summaryRows = [
                    ['Invoice Total', this.formatAmount(invoiceTotal, settings), false],
                    ['Total Paid (incl. this payment)', this.formatAmount(totalPaid, settings), false],
                ];

                const labelX = 320;
                const valueX = 455;
                const labelW = valueX - labelX - 8;
                const valueW = R - valueX;

                doc.font('Helvetica').fontSize(10).fillColor('#374151');
                summaryRows.forEach(([label, value]) => {
                    doc.text(label, labelX, y, { width: labelW, align: 'right' });
                    doc.text(value, valueX, y, { width: valueW, align: 'right' });
                    y += 18;
                });

                // Divider line
                doc.strokeColor('#374151').lineWidth(1)
                    .moveTo(labelX, y + 3).lineTo(R, y + 3).stroke();
                y += 12;

                // Total row
                if (balanceDue > 0) {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor(theme.accent)
                        .text('Balance Due', labelX, y, { width: labelW, align: 'right' })
                        .text(this.formatAmount(balanceDue, settings), valueX, y, { width: valueW, align: 'right' });
                } else {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor('#059669')
                        .text('Fully Paid ✓', labelX, y, { width: labelW, align: 'right' })
                        .text(this.formatAmount(0, settings), valueX, y, { width: valueW, align: 'right' });
                }

                y += 36;

                // ── 5. FOOTER ─────────────────────────────────────────────────
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
