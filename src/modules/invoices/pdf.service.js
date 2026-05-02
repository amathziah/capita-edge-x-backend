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
            name: settings.business_name || settings.businessName || settings.organization_name || settings.owner_name || 'Your Business',
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
     * Convert a number to Indian words (Lakh/Crore format).
     * Mirrors numberToWords in InvoiceDocumentPreview.tsx.
     */
    numberToWords(num) {
        const n = Math.floor(Number(num) || 0);
        if (n === 0) return 'Indian Rupee Zero';
        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
            'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
            'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        const cvt = (x) => {
            if (x < 20) return ones[x];
            if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ` ${ones[x % 10]}` : '');
            if (x < 1000) return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ` ${cvt(x % 100)}` : '');
            if (x < 100000) return cvt(Math.floor(x / 1000)) + ' Thousand' + (x % 1000 ? ` ${cvt(x % 1000)}` : '');
            if (x < 10000000) return cvt(Math.floor(x / 100000)) + ' Lakh' + (x % 100000 ? ` ${cvt(x % 100000)}` : '');
            return cvt(Math.floor(x / 10000000)) + ' Crore' + (x % 10000000 ? ` ${cvt(x % 10000000)}` : '');
        };
        return `Indian Rupee ${cvt(n)}`;
    }

    /**
     * Generate invoice PDF — mirrors InvoiceDocumentPreview.tsx.
     * Single compact A4 page with header, billing blocks, items table,
     * totals, payment instructions, notes, terms, and signature.
     */
    async generateInvoicePDF(invoice, settings = {}, outputPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 40 });
                const stream = fs.createWriteStream(outputPath);
                doc.pipe(stream);

                const L = doc.page.margins.left;
                const R = doc.page.width - doc.page.margins.right;
                const W = R - L;

                const seller = this.getSeller(invoice, settings);
                const buyer = this.getBuyer(invoice);
                const items = this.getItems(invoice);
                const documentTitle = this.getDocumentTitle(invoice);
                const currency = this.getCurrencySymbol(settings);

                const fmt = (v) => {
                    const num = Number(v || 0);
                    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                };
                const money = (v) => `${currency}${fmt(v)}`;

                let y = 40;

                // ── HEADER ──────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827')
                    .text(seller.name || 'Your Business', L, y, { width: 320 });
                let leftY = y + 17;

                const headerTitle = settings.businessTitle || settings.fromTitle;
                if (headerTitle) {
                    doc.font('Helvetica-Bold').fontSize(7).fillColor('#0D9488')
                        .text(String(headerTitle).toUpperCase(), L, leftY, {
                            width: 320, characterSpacing: 0.6,
                        });
                    leftY += 10;
                }
                if (seller.address) {
                    doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                        .text(seller.address, L, leftY, { width: 320 });
                    leftY += doc.heightOfString(seller.address, { width: 320 }) + 2;
                }
                if (seller.taxId) {
                    doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                        .text(`GSTIN: ${seller.taxId}`, L, leftY, { width: 320 });
                    leftY += 11;
                }

                const titleW = 180;
                const titleX = R - titleW;
                doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827')
                    .text(documentTitle, titleX, y - 2, { width: titleW, align: 'right' });
                doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#9CA3AF')
                    .text(String(invoice?.invoiceNumber || '').toUpperCase(),
                        titleX, y + 22, { width: titleW, align: 'right', characterSpacing: 0.8 });

                y = Math.max(leftY, y + 40) + 16;

                // ── BILLED FROM / BILLED TO ─────────────────────────
                const colW = (W - 20) / 2;
                const col1X = L;
                const col2X = L + colW + 20;

                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('BILLED FROM', col1X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('BILLED TO', col2X, y, { width: colW, characterSpacing: 0.8 });

                let fromY = y + 12;
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(seller.name || '—', col1X, fromY, { width: colW });
                fromY += 13;
                if (seller.address) {
                    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
                        .text(seller.address, col1X, fromY, { width: colW, lineGap: 1 });
                    fromY += doc.heightOfString(seller.address, { width: colW, lineGap: 1 }) + 2;
                }

                let toY = y + 12;
                const buyerName = buyer?.name || 'Customer';
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(buyerName, col2X, toY, { width: colW });
                toY += 13;
                if (buyer?.email) {
                    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
                        .text(buyer.email, col2X, toY, { width: colW });
                    toY += 11;
                }
                const buyerAddressParts = [
                    buyer?.address || buyer?.addressLine1 || '',
                    buyer?.addressLine2 || '',
                    [buyer?.city, buyer?.state, buyer?.pincode].filter(Boolean).join(', '),
                ].filter(Boolean);
                const buyerAddress = buyerAddressParts.join(', ');
                if (buyerAddress) {
                    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
                        .text(buyerAddress, col2X, toY, { width: colW, lineGap: 1 });
                    toY += doc.heightOfString(buyerAddress, { width: colW, lineGap: 1 }) + 2;
                }
                if (buyer?.gstin) {
                    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
                        .text(`GSTIN: ${buyer.gstin}`, col2X, toY, { width: colW });
                    toY += 11;
                }

                y = Math.max(fromY, toY) + 10;

                // ── DATES ───────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('INVOICE DATE', col1X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('DUE DATE', col2X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(this.formatDate(invoice?.date || new Date()), col1X, y + 11, { width: colW });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(this.formatDate(invoice?.dueDate), col2X, y + 11, { width: colW });
                y += 30;
                doc.strokeColor('#F3F4F6').lineWidth(1)
                    .moveTo(L, y).lineTo(R, y).stroke();
                y += 12;

                // ── ITEMS TABLE ────────────────────────────────────
                const tbl = {
                    desc: { x: L + 12, w: 260 },
                    qty: { x: L + 12 + 260, w: 50 },
                    rate: { x: L + 12 + 260 + 50, w: 90 },
                    amt: { x: L + 12 + 260 + 50 + 90, w: 90 },
                };
                const tableStartY = y;
                doc.roundedRect(L, y, W, 22, 6).fillAndStroke('#F9FAFB', '#E5E7EB');
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF');
                doc.text('DESCRIPTION', tbl.desc.x, y + 8, { width: tbl.desc.w, characterSpacing: 0.8 });
                doc.text('QTY', tbl.qty.x, y + 8, { width: tbl.qty.w, align: 'center', characterSpacing: 0.8 });
                doc.text('RATE', tbl.rate.x, y + 8, { width: tbl.rate.w, align: 'right', characterSpacing: 0.8 });
                doc.text('AMOUNT', tbl.amt.x, y + 8, { width: tbl.amt.w, align: 'right', characterSpacing: 0.8 });
                y += 22;

                if (items.length === 0) {
                    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#D1D5DB')
                        .text('No items added yet', L, y + 12, { width: W, align: 'center' });
                    y += 34;
                } else {
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        const qty = Number(item.quantity || 0);
                        const price = Number(item.price || 0);
                        const amt = this.getLineAmount(item);
                        const desc = this.safeText(item.description || 'Item');
                        const descH = doc.heightOfString(desc, { width: tbl.desc.w });
                        const rowH = Math.max(22, descH + 12);

                        doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
                            .text(desc, tbl.desc.x, y + 6, { width: tbl.desc.w });
                        doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                            .text(String(qty), tbl.qty.x, y + 6, { width: tbl.qty.w, align: 'center' });
                        doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                            .text(money(price), tbl.rate.x, y + 6, { width: tbl.rate.w, align: 'right' });
                        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937')
                            .text(money(amt), tbl.amt.x, y + 6, { width: tbl.amt.w, align: 'right' });

                        y += rowH;
                        if (i < items.length - 1) {
                            doc.strokeColor('#F3F4F6').lineWidth(0.5)
                                .moveTo(L, y).lineTo(R, y).stroke();
                        }
                    }
                }

                doc.roundedRect(L, tableStartY, W, y - tableStartY, 6)
                    .lineWidth(0.75).strokeColor('#E5E7EB').stroke();
                y += 14;

                // ── TOTALS (right-aligned) ─────────────────────────
                const subtotal = Number(invoice?.subtotal || 0);
                const taxAmount = Number(invoice?.taxAmount || invoice?.tax_amount || 0);
                const discount = Number(invoice?.discountAmount || invoice?.discount_amount || invoice?.discount || 0);
                const shipping = Number(invoice?.shipping || 0);
                const tdsAmount = Number(invoice?.tdsAmount || invoice?.tds_amount || 0);
                const total = Number(invoice?.total || 0);
                const netRecv = Number(invoice?.netReceivable || invoice?.net_receivable || total);
                const taxRate = Number(invoice?.taxRate || invoice?.tax_rate || 0);
                const gstType = invoice?.gstType || invoice?.gst_type || '';
                const igstAmount = Number(invoice?.igstAmount || invoice?.igst_amount || 0);
                const cgstAmount = Number(invoice?.cgstAmount || invoice?.cgst_amount || 0);
                const sgstAmount = Number(invoice?.sgstAmount || invoice?.sgst_amount || 0);
                const tdsRate = Number(invoice?.tdsRate || invoice?.tds_rate || 0);
                const isGstRegistered = invoice?.isGstRegistered !== false && invoice?.is_gst_registered !== false;

                const totalsW = 260;
                const totalsX = R - totalsW;
                const labelW = 110;
                const valueW = totalsW - labelW;

                const totRow = (label, value, opts = {}) => {
                    const size = opts.size || 9;
                    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
                        .fontSize(size)
                        .fillColor(opts.labelColor || '#9CA3AF')
                        .text(label, totalsX, y, { width: labelW });
                    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
                        .fontSize(size)
                        .fillColor(opts.valueColor || '#374151')
                        .text(value, totalsX + labelW, y, { width: valueW, align: 'right' });
                    y += size + 5;
                };

                totRow('Subtotal', money(subtotal));
                if (isGstRegistered && taxAmount > 0) {
                    if (gstType === 'igst' || igstAmount > 0) {
                        totRow(`IGST (${taxRate}%)`, money(igstAmount || taxAmount));
                    } else {
                        totRow(`CGST (${(taxRate / 2).toFixed(2)}%)`, money(cgstAmount || taxAmount / 2));
                        totRow(`SGST (${(taxRate / 2).toFixed(2)}%)`, money(sgstAmount || taxAmount / 2));
                    }
                }
                if (discount > 0) {
                    totRow('Discount', `-${money(discount)}`, {
                        labelColor: '#F87171', valueColor: '#F87171',
                    });
                }
                if (shipping > 0) totRow('Shipping', money(shipping));
                if (tdsAmount > 0) {
                    totRow(`TDS (${tdsRate}%)`, `-${money(tdsAmount)}`, {
                        labelColor: '#F59E0B', valueColor: '#F59E0B',
                    });
                }

                y += 4;
                doc.strokeColor('#111827').lineWidth(1.5)
                    .moveTo(totalsX, y).lineTo(totalsX + totalsW, y).stroke();
                y += 8;

                doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                    .text('Total', totalsX, y + 4, { width: labelW });
                doc.font('Helvetica-Bold').fontSize(16).fillColor('#059669')
                    .text(money(total), totalsX + labelW, y, { width: valueW, align: 'right' });
                y += 24;

                if (tdsAmount > 0) {
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#F59E0B')
                        .text('You Receive', totalsX, y, { width: labelW });
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('#F59E0B')
                        .text(money(netRecv), totalsX + labelW, y, { width: valueW, align: 'right' });
                    y += 15;
                }

                const wordsAmount = tdsAmount > 0 ? netRecv : total;
                const wordsText = this.numberToWords(wordsAmount);
                doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9CA3AF')
                    .text(wordsText, totalsX, y + 2, { width: totalsW, align: 'right' });
                y += doc.heightOfString(wordsText, { width: totalsW }) + 12;

                // ── PAYMENT INSTRUCTIONS ───────────────────────────
                const hasBank = Boolean(seller.bankName || seller.accountNumber);
                const hasUpi = Boolean(seller.upiId);
                const hasQr = Boolean(seller.paymentQrPath || seller.upiId);

                if (hasBank || hasUpi || hasQr) {
                    const boxH = 100;
                    doc.roundedRect(L, y, W, boxH, 10)
                        .fillAndStroke('#F9FAFB', '#F3F4F6');

                    const pL = L + 18;
                    const pT = y + 14;
                    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                        .text('PAYMENT INSTRUCTIONS', pL, pT, { characterSpacing: 0.8 });

                    let infoY = pT + 16;
                    if (hasBank) {
                        doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                            .text('BANK TRANSFER', pL, infoY, { characterSpacing: 0.5 });
                        infoY += 10;
                        if (seller.bankName) {
                            doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937')
                                .text(seller.bankName, pL, infoY, { width: 260 });
                            infoY += 11;
                        }
                        if (seller.accountNumber) {
                            doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                                .text(`A/C: ${seller.accountNumber}`, pL, infoY, { width: 260 });
                            infoY += 10;
                        }
                        if (seller.ifscCode) {
                            doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                                .text(`IFSC: ${seller.ifscCode}`, pL, infoY, { width: 260 });
                            infoY += 10;
                        }
                    }
                    if (hasUpi) {
                        if (hasBank) infoY += 4;
                        doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                            .text('UPI PAYMENT', pL, infoY, { characterSpacing: 0.5 });
                        infoY += 10;
                        doc.font('Helvetica-Bold').fontSize(9).fillColor('#059669')
                            .text(seller.upiId, pL, infoY, { width: 260 });
                        infoY += 11;
                    }

                    if (hasQr) {
                        try {
                            const qrSize = 74;
                            const qrX = R - 18 - qrSize;
                            const qrY = y + 12;
                            if (seller.paymentQrPath && fs.existsSync(seller.paymentQrPath)) {
                                doc.image(seller.paymentQrPath, qrX, qrY, {
                                    width: qrSize, height: qrSize, fit: [qrSize, qrSize],
                                });
                            } else if (seller.upiId) {
                                const payable = this.getPayableAmount(invoice);
                                const qrData = `upi://pay?pa=${seller.upiId}&pn=${encodeURIComponent(seller.name || 'Business')}&am=${payable.toFixed(2)}&cu=INR`;
                                const qrDataUrl = await QRCode.toDataURL(qrData, { margin: 0, width: 200 });
                                const qrBuf = Buffer.from(qrDataUrl.split(',')[1], 'base64');
                                doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
                            }
                            doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
                                .text('Scan to Pay', qrX - 4, qrY + qrSize + 4, {
                                    width: qrSize + 8, align: 'center',
                                });
                        } catch (err) {
                            console.error('Payment QR render error:', err);
                        }
                    }

                    y += boxH + 12;
                }

                // ── NOTES ───────────────────────────────────────────
                const notesText = this.safeText(invoice?.notes || settings?.invoiceNotes);
                if (notesText) {
                    doc.strokeColor('#F3F4F6').lineWidth(0.5)
                        .moveTo(L, y).lineTo(R, y).stroke();
                    y += 10;
                    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                        .text('NOTES', L, y, { characterSpacing: 0.8 });
                    y += 11;
                    doc.font('Helvetica').fontSize(8.5).fillColor('#4B5563')
                        .text(notesText, L, y, { width: W, lineGap: 1.5 });
                    y += doc.heightOfString(notesText, { width: W, lineGap: 1.5 }) + 10;
                }

                // ── TERMS ───────────────────────────────────────────
                const termsText = this.safeText(seller.terms || invoice?.terms);
                if (termsText) {
                    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                        .text('TERMS & CONDITIONS', L, y, { characterSpacing: 0.8 });
                    y += 11;
                    doc.font('Helvetica').fontSize(8.5).fillColor('#4B5563')
                        .text(termsText, L, y, { width: W, lineGap: 1.5 });
                    y += doc.heightOfString(termsText, { width: W, lineGap: 1.5 }) + 10;
                }

                // ── SIGNATURE ───────────────────────────────────────
                if (seller.includeSignature) {
                    y += 4;
                    doc.strokeColor('#F3F4F6').lineWidth(0.5)
                        .moveTo(L, y).lineTo(R, y).stroke();
                    y += 12;
                    const sigW = 160;
                    const sigX = R - sigW;
                    const sigName = seller.signatureName || seller.name || 'Signature';
                    doc.font('Times-Italic').fontSize(13).fillColor('#374151')
                        .text(sigName, sigX, y, { width: sigW, align: 'center' });
                    y += 20;
                    doc.strokeColor('#9CA3AF').lineWidth(0.5)
                        .moveTo(sigX, y).lineTo(sigX + sigW, y).stroke();
                    doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
                        .text('Authorised Signature', sigX, y + 4, {
                            width: sigW, align: 'center', characterSpacing: 0.5,
                        });
                    y += 16;
                }

                // ── FOOTER TAGLINE (anchored at page bottom) ────────
                const footerY = doc.page.height - doc.page.margins.bottom - 16;
                doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF')
                    .text(settings?.footerText || 'Thank you for your business!',
                        L, footerY, { width: W, align: 'center' });

                doc.end();
                stream.on('finish', () => resolve(outputPath));
                stream.on('error', reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Add footer — used by generateReceiptPDF.
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

                const methodRaw = payment.method || payment.payment_mode || 'other';
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

    /**
     * Generate invoice PDF in-memory and return as a Buffer.
     * No temp file is written to disk — safe for serverless/AI email dispatch.
     */
    async generateInvoicePDFBuffer(invoice, settings = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 40 });
                const chunks = [];

                doc.on('data', (chunk) => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                // Re-use the same rendering logic from generateInvoicePDF
                const L = doc.page.margins.left;
                const R = doc.page.width - doc.page.margins.right;
                const W = R - L;

                const seller = this.getSeller(invoice, settings);
                const buyer = this.getBuyer(invoice);
                const items = this.getItems(invoice);
                const documentTitle = this.getDocumentTitle(invoice);
                const currency = this.getCurrencySymbol(settings);

                const fmt = (v) => {
                    const num = Number(v || 0);
                    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                };
                const money = (v) => `${currency}${fmt(v)}`;

                let y = 40;

                // ── HEADER ──────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827')
                    .text(seller.name || 'Your Business', L, y, { width: 320 });
                let leftY = y + 17;

                if (seller.address) {
                    doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                        .text(seller.address, L, leftY, { width: 320 });
                    leftY += doc.heightOfString(seller.address, { width: 320 }) + 2;
                }
                if (seller.taxId) {
                    doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
                        .text(`GSTIN: ${seller.taxId}`, L, leftY, { width: 320 });
                    leftY += 11;
                }

                const titleW = 180;
                const titleX = R - titleW;
                doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827')
                    .text(documentTitle, titleX, y - 2, { width: titleW, align: 'right' });
                doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#9CA3AF')
                    .text(String(invoice?.invoiceNumber || '').toUpperCase(),
                        titleX, y + 22, { width: titleW, align: 'right', characterSpacing: 0.8 });

                y = Math.max(leftY, y + 40) + 16;

                // ── BILLED FROM / BILLED TO ─────────────────────────
                const colW = (W - 20) / 2;
                const col1X = L;
                const col2X = L + colW + 20;

                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('BILLED FROM', col1X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('BILLED TO', col2X, y, { width: colW, characterSpacing: 0.8 });

                let fromY = y + 12;
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(seller.name || '—', col1X, fromY, { width: colW });
                fromY += 13;

                let toY = y + 12;
                const buyerName = buyer?.name || 'Customer';
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(buyerName, col2X, toY, { width: colW });
                toY += 13;
                if (buyer?.email) {
                    doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280')
                        .text(buyer.email, col2X, toY, { width: colW });
                    toY += 11;
                }

                y = Math.max(fromY, toY) + 10;

                // ── DATES ───────────────────────────────────────────
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('INVOICE DATE', col1X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF')
                    .text('DUE DATE', col2X, y, { width: colW, characterSpacing: 0.8 });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(this.formatDate(invoice?.date || new Date()), col1X, y + 11, { width: colW });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1F2937')
                    .text(this.formatDate(invoice?.dueDate), col2X, y + 11, { width: colW });
                y += 30;
                doc.strokeColor('#F3F4F6').lineWidth(1)
                    .moveTo(L, y).lineTo(R, y).stroke();
                y += 12;

                // ── ITEMS TABLE ─────────────────────────────────────
                const tbl = {
                    desc: { x: L + 12, w: 260 },
                    qty:  { x: L + 12 + 260, w: 50 },
                    rate: { x: L + 12 + 260 + 50, w: 90 },
                    amt:  { x: L + 12 + 260 + 50 + 90, w: 90 },
                };
                const tableStartY = y;
                doc.roundedRect(L, y, W, 22, 6).fillAndStroke('#F9FAFB', '#E5E7EB');
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#9CA3AF');
                doc.text('DESCRIPTION', tbl.desc.x, y + 8, { width: tbl.desc.w, characterSpacing: 0.8 });
                doc.text('QTY', tbl.qty.x, y + 8, { width: tbl.qty.w, align: 'center', characterSpacing: 0.8 });
                doc.text('RATE', tbl.rate.x, y + 8, { width: tbl.rate.w, align: 'right', characterSpacing: 0.8 });
                doc.text('AMOUNT', tbl.amt.x, y + 8, { width: tbl.amt.w, align: 'right', characterSpacing: 0.8 });
                y += 22;

                if (items.length === 0) {
                    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#D1D5DB')
                        .text('No items added yet', L, y + 12, { width: W, align: 'center' });
                    y += 34;
                } else {
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        const qty = Number(item.quantity || 0);
                        const price = Number(item.price || 0);
                        const amt = this.getLineAmount(item);
                        const desc = this.safeText(item.description || 'Item');
                        const descH = doc.heightOfString(desc, { width: tbl.desc.w });
                        const rowH = Math.max(22, descH + 12);

                        doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
                            .text(desc, tbl.desc.x, y + 6, { width: tbl.desc.w });
                        doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                            .text(String(qty), tbl.qty.x, y + 6, { width: tbl.qty.w, align: 'center' });
                        doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
                            .text(money(price), tbl.rate.x, y + 6, { width: tbl.rate.w, align: 'right' });
                        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937')
                            .text(money(amt), tbl.amt.x, y + 6, { width: tbl.amt.w, align: 'right' });

                        y += rowH;
                        if (i < items.length - 1) {
                            doc.strokeColor('#F3F4F6').lineWidth(0.5)
                                .moveTo(L, y).lineTo(R, y).stroke();
                        }
                    }
                }

                doc.roundedRect(L, tableStartY, W, y - tableStartY, 6)
                    .lineWidth(0.75).strokeColor('#E5E7EB').stroke();
                y += 14;

                // ── TOTALS ──────────────────────────────────────────
                const subtotal = Number(invoice?.subtotal || 0);
                const total = Number(invoice?.total || 0);
                const totalsW = 260;
                const totalsX = R - totalsW;
                const labelW = 110;
                const valueW = totalsW - labelW;

                const totRow = (label, value, opts = {}) => {
                    const size = opts.size || 9;
                    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
                        .fontSize(size).fillColor(opts.labelColor || '#9CA3AF')
                        .text(label, totalsX, y, { width: labelW });
                    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
                        .fontSize(size).fillColor(opts.valueColor || '#374151')
                        .text(value, totalsX + labelW, y, { width: valueW, align: 'right' });
                    y += size + 5;
                };

                totRow('Subtotal', money(subtotal));
                y += 4;
                doc.strokeColor('#111827').lineWidth(1.5)
                    .moveTo(totalsX, y).lineTo(totalsX + totalsW, y).stroke();
                y += 8;

                doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
                    .text('Total', totalsX, y + 4, { width: labelW });
                doc.font('Helvetica-Bold').fontSize(16).fillColor('#059669')
                    .text(money(total), totalsX + labelW, y, { width: valueW, align: 'right' });
                y += 24;

                const wordsText = this.numberToWords(total);
                doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9CA3AF')
                    .text(wordsText, totalsX, y + 2, { width: totalsW, align: 'right' });
                y += 20;

                // ── FOOTER ──────────────────────────────────────────
                const footerY = doc.page.height - doc.page.margins.bottom - 16;
                doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF')
                    .text(settings?.footerText || 'Thank you for your business!',
                        L, footerY, { width: W, align: 'center' });

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

export default new PDFService();
