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
    /**
     * Add header with logo
     */
    async addHeader(doc, settings, invoice, title = null) {
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

        if (!title) {
            // Plain invoice header — right-aligned, no colored box
            doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
                .text(this.getDocumentTitle(invoice), rightX, y, { width: 185, align: 'right' });

            doc.font('Helvetica-Bold').fontSize(8).fillColor('#6B7280')
                .text('INVOICE #', rightX, y + 28, { width: 185, align: 'right' });
            doc.font('Helvetica').fontSize(10).fillColor('#111827')
                .text(this.safeText(invoice?.invoiceNumber), rightX, y + 40, { width: 185, align: 'right' });

            doc.font('Helvetica-Bold').fontSize(8).fillColor('#6B7280')
                .text(`Issued: ${this.formatDate(invoice?.date || new Date())}  |  Due: ${this.formatDate(invoice?.dueDate)}`, rightX, y + 58, { width: 185, align: 'right' });
        } else {
            // Receipt / other document header
            doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
                .text(title, rightX, y, { width: 185, align: 'right' });

            doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                .text(`Receipt No: ${invoice?.invoiceNumber || invoice?.id?.split('-')[0].toUpperCase()}`, rightX, y + 28, { width: 185, align: 'right' });
            doc.text(`Date: ${this.formatDate(new Date())}`, rightX, y + 40, { width: 185, align: 'right' });
        }

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
        let y = startY + 10;
        const leftX = doc.page.margins.left;
        const rightX = 315;
        const columnWidth = 225;

        doc.fontSize(8.5)
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

        doc.font('Helvetica').fontSize(10.5).fillColor('#111827');
        const leftHeight = doc.heightOfString(sellerLines.join('\n'), { width: columnWidth, lineGap: 2.5 });
        const rightHeight = doc.heightOfString(buyerLines.join('\n'), { width: columnWidth, lineGap: 2.5 });

        doc.text(sellerLines.join('\n'), leftX, y + 18, { width: columnWidth, lineGap: 2.8 });
        doc.text(buyerLines.join('\n'), rightX, y + 18, { width: columnWidth, lineGap: 2.8 });

        let nextY = y + 28 + Math.max(leftHeight, rightHeight);
        const complianceBits = [
            invoice?.placeOfSupply ? `Place of Supply: ${invoice.placeOfSupply}` : '',
            invoice?.projectName ? `Project: ${invoice.projectName}` : '',
            invoice?.reverseCharge ? 'Reverse Charge: Yes' : '',
        ].filter(Boolean);

        if (complianceBits.length > 0) {
            doc.font('Helvetica')
                .fontSize(9)
                .fillColor('#64748B')
                .text(complianceBits.join('    '), leftX, nextY + 8, { width: 500 });
            nextY += 28;
        }

        return nextY + 12;
    }

    /**
     * Add items table
     */
    addItemsTable(doc, invoice, settings, startY) {
        const items = this.getItems(invoice);
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        
        const drawHeader = (headerY) => {
            // No rounded box for 'Clean & Simple'
            this.drawDivider(doc, headerY, '#E2E8F0');
            
            doc.font('Helvetica-Bold')
                .fontSize(8.5)
                .fillColor('#374151')
                .text('DESCRIPTION', 60, headerY + 12, { width: 235 })
                .text('QTY', 300, headerY + 12, { width: 50, align: 'center' })
                .text('RATE', 360, headerY + 12, { width: 85, align: 'right' })
                .text('AMOUNT', 450, headerY + 12, { width: 85, align: 'right' });
            
            this.drawDivider(doc, headerY + 34, '#F1F5F9');
            return headerY + 44;
        };

        let y = drawHeader(startY);

        if (items.length === 0) {
            doc.font('Helvetica')
                .fontSize(10)
                .fillColor('#94A3B8')
                .text('No line items added.', 60, y + 10);
            return y + 40;
        }

        for (const item of items) {
            const quantity = Number(item.quantity || 0);
            const price = Number(item.price || 0);
            const amount = this.getLineAmount(item);
            const itemCode = item.hsnCode || item.hsn_code || item.sacCode || item.sac_code;
            const descriptionLines = [
                this.safeText(item.description || 'Item'),
            ].filter(Boolean).join('\n');

            const rowHeight = Math.max(
                28,
                doc.heightOfString(descriptionLines, { width: 235, lineGap: 2 }) + 12
            );

            y = this.ensureSpace(doc, y, rowHeight + 10, () => drawHeader(50));

            doc.font('Helvetica-Bold')
                .fontSize(10.5)
                .fillColor('#1E293B')
                .text(descriptionLines, 60, y, { width: 235, lineGap: 2 });
            
            if (itemCode) {
                doc.font('Helvetica')
                    .fontSize(8)
                    .fillColor('#64748B')
                    .text(`${item.hsnCode || item.hsn_code ? 'HSN' : 'SAC'}: ${itemCode}`, 60, doc.y + 2);
            }

            doc.font('Helvetica')
                .fontSize(10.5)
                .fillColor('#1E293B')
                .text(`${quantity}${item.unit ? ` ${item.unit}` : ''}`, 300, y, { width: 50, align: 'center' })
                .text(this.formatAmount(price, settings), 360, y, { width: 85, align: 'right' })
                .text(this.formatAmount(amount, settings), 450, y, { width: 85, align: 'right' });

            y += rowHeight + 8;
            this.drawDivider(doc, y, '#F1F5F9');
            y += 12;
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
        }

        let y = this.ensureSpace(doc, startY, (summaryRows.length + 3) * 22, () => 50);
        const labelX = 320;
        const valueX = 450;

        doc.font('Helvetica').fontSize(10.5).fillColor('#475569');
        summaryRows.forEach(([label, value]) => {
            doc.text(label, labelX, y, { width: 120, align: 'right' });
            doc.text(value, valueX, y, { width: 85, align: 'right' });
            y += 22;
        });

        this.drawDivider(doc, y + 4, '#CBD5E1');

        y += 18;

        doc.font('Helvetica-Bold')
            .fontSize(14)
            .fillColor('#0F172A')
            .text('Amount Due', labelX, y, { width: 120, align: 'right' })
            .text(this.formatAmount(total, settings), valueX, y, { width: 85, align: 'right' });

        return y + 40;
    }

    /**
     * Add payment info and QR code — Minimalist & High-end
     */
    async addPaymentInfo(doc, invoice, settings, startY) {
        const theme = this.getTheme(invoice?.persona || settings?.businessType);
        const seller = this.getSeller(invoice, settings);
        const paymentLines = [
            seller.upiId ? `UPI ID: ${seller.upiId}` : '',
            seller.bankName ? `Bank: ${seller.bankName}` : '',
            seller.accountNumber ? `Account: ${seller.accountNumber}` : '',
            seller.ifscCode ? `IFSC: ${seller.ifscCode}` : '',
        ].filter(Boolean);
        const paymentBody = paymentLines.join('\n');
        const hasQr = Boolean(seller.paymentQrPath || seller.upiId);
        const blockHeight = Math.max(paymentBody ? doc.heightOfString(paymentBody, { width: 280, lineGap: 3.5 }) + 45 : 0, hasQr ? 120 : 0, 80);
        let y = this.ensureSpace(doc, startY, blockHeight + 30, () => 50);

        // No box background, just clean typography and layout
        this.drawDivider(doc, y, '#E2E8F0');
        y += 18;

        doc.font('Helvetica-Bold')
            .fontSize(9)
            .fillColor(theme.muted)
            .text('PAYMENT INFORMATION', 50, y);

        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#0F172A')
            .text(
                paymentBody || 'Alternative payment instructions provided on request.',
                50,
                y + 18,
                { width: hasQr ? 300 : 495, lineGap: 3.5 }
            );

        if (hasQr) {
            try {
                const qrX = 415;
                const qrY = y - 10;
                if (seller.paymentQrPath && fs.existsSync(seller.paymentQrPath)) {
                    doc.image(seller.paymentQrPath, qrX, qrY, { width: 90, height: 90, fit: [90, 90] });
                } else if (seller.upiId) {
                    const payableAmount = this.getPayableAmount(invoice);
                    const qrData = `upi://pay?pa=${seller.upiId}&pn=${encodeURIComponent(seller.name || settings.businessName || 'Business')}&am=${payableAmount.toFixed(2)}&cu=INR`;
                    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { margin: 0, width: 120 });
                    const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
                    doc.image(qrBuffer, qrX, qrY, { width: 90, height: 90 });
                }
                
                doc.font('Helvetica-Bold')
                    .fontSize(7.5)
                    .fillColor('#64748B')
                    .text('Scan for instant payment', qrX - 5, qrY + 98, { width: 100, align: 'center' });
            } catch (err) {
                console.error('Payment QR render error:', err);
            }
        }

        return y + blockHeight + 10;
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
    /**
     * Generate payment receipt PDF — Clean and Simple Redesign
     */
    formatPaymentMethod(raw) {
        const map = {
            upi: 'UPI',
            neft: 'NEFT',
            imps: 'IMPS',
            rtgs: 'RTGS',
            cheque: 'Cheque',
            cash: 'Cash',
            card: 'Credit/Debit Card',
            bank_transfer: 'Bank Transfer',
            razorpay: 'Razorpay',
            stripe: 'Stripe',
            other: 'Other',
        };
        const key = (raw || 'other').toString().toLowerCase().trim();
        return map[key] || raw;
    }

    async generateReceiptPDF(payment, invoice, settings = {}, outputPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const stream = fs.createWriteStream(outputPath);
                doc.pipe(stream);

                const L = doc.page.margins.left;
                const R = doc.page.width - doc.page.margins.right;
                const W = R - L;
                const buyer = this.getBuyer(invoice);
                const seller = this.getSeller(invoice, settings);
                const paymentDate = payment.date || payment.createdAt;
                const labelCol = L;
                const valueCol = L + 160;
                const valueW = W - 160;

                // Helper: draw a label-value row at fixed y, returns next y
                const row = (label, value, atY, opts = {}) => {
                    const fSize = opts.fontSize || 10;
                    const labelFont = opts.labelBold ? 'Helvetica-Bold' : 'Helvetica';
                    const valueFont = opts.valueBold ? 'Helvetica-Bold' : 'Helvetica';
                    const labelColor = opts.labelColor || '#4B5563';
                    const valueColor = opts.valueColor || '#111827';
                    doc.font(labelFont).fontSize(fSize).fillColor(labelColor)
                        .text(label, labelCol, atY, { width: 155 });
                    doc.font(valueFont).fontSize(fSize).fillColor(valueColor)
                        .text(String(value || '-'), valueCol, atY, { width: valueW });
                    return atY + fSize + 8;
                };

                // Helper: section heading
                const heading = (title, atY) => {
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
                        .text(title, L, atY, { width: W });
                    return atY + 18;
                };

                // Helper: divider line
                const divider = (atY) => {
                    doc.strokeColor('#D1D5DB').lineWidth(0.5)
                        .moveTo(L, atY).lineTo(R, atY).stroke();
                    return atY + 16;
                };

                let y = 50;

                // ── HEADER ──────────────────────────────────────────────────
                // Company name + details on left
                const logoPath = settings.logoPath;
                let nameX = L;
                if (logoPath && fs.existsSync(logoPath)) {
                    try {
                        doc.image(logoPath, L, y, { width: 48, height: 48, fit: [48, 48] });
                        nameX = L + 58;
                    } catch (_) { /* skip logo on error */ }
                }

                doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827')
                    .text(seller.name, nameX, y, { width: 230 });
                let infoY = y + 18;
                const companyInfo = [
                    seller.address, seller.phone, seller.email,
                    seller.taxId ? `GSTIN: ${seller.taxId}` : '',
                ].filter(Boolean);
                doc.font('Helvetica').fontSize(8).fillColor('#6B7280');
                companyInfo.forEach((line) => {
                    doc.text(line, nameX, infoY, { width: 230 });
                    infoY += 11;
                });

                // "PAYMENT RECEIPT" title on right
                doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
                    .text('PAYMENT RECEIPT', R - 200, y, { width: 200, align: 'right' });

                doc.font('Helvetica').fontSize(9).fillColor('#4B5563')
                    .text(`Receipt #: RCT-${(payment.id || '').split('-')[0].toUpperCase()}`, R - 200, y + 22, { width: 200, align: 'right' });
                doc.font('Helvetica').fontSize(9).fillColor('#4B5563')
                    .text(`Date: ${this.formatDate(paymentDate)}`, R - 200, y + 34, { width: 200, align: 'right' });
                doc.font('Helvetica').fontSize(9).fillColor('#4B5563')
                    .text(`Invoice #: ${invoice.invoiceNumber || '-'}`, R - 200, y + 46, { width: 200, align: 'right' });

                y = Math.max(infoY, y + 60) + 12;
                y = divider(y);

                // ── AMOUNT RECEIVED ─────────────────────────────────────────
                doc.font('Helvetica').fontSize(10).fillColor('#4B5563')
                    .text('Amount Received', L, y, { width: 155 });
                doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
                    .text(this.formatAmount(payment.amount, settings), valueCol, y - 3, { width: valueW });
                y += 30;
                y = divider(y);

                // ── RECEIVED FROM ───────────────────────────────────────────
                y = heading('RECEIVED FROM', y);
                y = row('Name', buyer?.name || 'Customer', y, { valueBold: true });
                if (buyer?.email) y = row('Email', buyer.email, y);
                if (buyer?.phone) y = row('Phone', buyer.phone, y);
                if (buyer?.address) y = row('Address', buyer.address, y);
                y += 4;
                y = divider(y);

                // ── PAYMENT DETAILS ─────────────────────────────────────────
                y = heading('PAYMENT DETAILS', y);

                const methodRaw = payment.payment_mode || payment.method || 'other';
                y = row('Payment Method', this.formatPaymentMethod(methodRaw), y, { valueBold: true });
                y = row('Payment Date', this.formatDate(paymentDate), y);

                const refNum = payment.reference_number || payment.referenceNumber;
                if (refNum) y = row('Reference Number', refNum, y);

                const upiTxn = payment.upi_transaction_id || payment.upiTransactionId;
                if (upiTxn) y = row('UPI Transaction ID', upiTxn, y);

                y = row('Status', (payment.status || 'completed') === 'completed' ? 'Completed' : 'Pending', y);

                if (payment.notes) y = row('Notes', payment.notes, y);

                y += 4;
                y = divider(y);

                // ── BILLING SUMMARY ─────────────────────────────────────────
                y = heading('BILLING SUMMARY', y);

                const invoiceTotal = Number(invoice.net_receivable ?? invoice.total ?? 0);
                const totalPaid = Number(invoice.amount_paid || 0);
                const balanceDue = Math.max(invoiceTotal - totalPaid, 0);

                // Right-aligned amounts
                const amountRow = (label, amount, atY, bold) => {
                    doc.font('Helvetica').fontSize(10).fillColor('#4B5563')
                        .text(label, L, atY, { width: W - 140 });
                    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
                        .fillColor('#111827')
                        .text(this.formatAmount(amount, settings), R - 135, atY, { width: 135, align: 'right' });
                    return atY + 20;
                };

                y = amountRow('Invoice Total', invoiceTotal, y, false);
                y = amountRow('This Payment', payment.amount, y, false);
                y = amountRow('Total Collected', totalPaid, y, false);

                // Final line
                doc.strokeColor('#9CA3AF').lineWidth(0.75)
                    .moveTo(L, y).lineTo(R, y).stroke();
                y += 10;

                if (balanceDue > 0) {
                    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                        .text('Balance Remaining', L, y, { width: W - 140 });
                    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                        .text(this.formatAmount(balanceDue, settings), R - 135, y, { width: 135, align: 'right' });
                } else {
                    doc.font('Helvetica-Bold').fontSize(11).fillColor('#059669')
                        .text('INVOICE FULLY SETTLED', L, y, { width: W, align: 'center' });
                }

                y += 40;
                y = divider(y);

                // ── FOOTER ──────────────────────────────────────────────────
                doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                    .text('Thank you for your payment.', L, y, { width: W, align: 'center' });

                this.addFooter(doc, settings, invoice, y + 24);

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
