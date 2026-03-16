/**
 * Universal Invoice Engine — Financial Math
 * ==========================================
 * Precision-first calculation engine using decimal.js.
 * NEVER uses native JS floats for monetary arithmetic.
 *
 * Usage:
 *   import { InvoiceCalculator } from './server/lib/financialMath.js';
 *   const result = InvoiceCalculator.calculate({ line_items, tds_rate, ... });
 */

import Decimal from 'decimal.js';

// Configure decimal.js for financial precision
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDecimal(value) {
    if (value === undefined || value === null || value === '') return new Decimal(0);
    return new Decimal(value);
}

function toFixed4(d) {
    return d.toFixed(4);
}

function toFixed2(d) {
    return d.toFixed(2);
}

// ─── Line Item Calculations ──────────────────────────────────────────────────

export class InvoiceCalculator {

    /**
     * Calculate total for a single line item BEFORE tax.
     * line_total = (quantity × unit_price) − discount
     */
    static calculateLineTotal(quantity, unitPrice, discount) {
        const qty = toDecimal(quantity);
        const price = toDecimal(unitPrice);
        const gross = qty.mul(price);

        let discountAmount = new Decimal(0);

        if (discount && discount.value) {
            const discountValue = toDecimal(discount.value);
            if (discount.type === 'percentage') {
                discountAmount = gross.mul(discountValue).div(100);
            } else {
                discountAmount = discountValue;
            }
        }

        if (discountAmount.gt(gross)) {
            discountAmount = gross;
        }

        const lineTotal = gross.minus(discountAmount);
        return { lineTotal, discountAmount };
    }

    /**
     * Calculate tax breakdown for a line item.
     * If `isInterstate` → full amount goes to IGST.
     * Otherwise → split 50/50 into CGST + SGST.
     */
    static calculateTaxForLine(lineTotal, taxRate, isInterstate = false) {
        const rate = toDecimal(taxRate);

        if (rate.isZero()) {
            return {
                taxAmount: new Decimal(0),
                breakdown: {
                    cgst_rate: 0, cgst: 0,
                    sgst_rate: 0, sgst: 0,
                    igst_rate: 0, igst: 0,
                    cess_rate: 0, cess: 0,
                },
            };
        }

        const taxAmount = lineTotal.mul(rate).div(100);

        let breakdown;

        if (isInterstate) {
            breakdown = {
                cgst_rate: 0,
                cgst: 0,
                sgst_rate: 0,
                sgst: 0,
                igst_rate: Number(rate.toFixed(2)),
                igst: Number(taxAmount.toFixed(2)),
                cess_rate: 0,
                cess: 0,
            };
        } else {
            const halfRate = rate.div(2);
            const halfTax = taxAmount.div(2);
            breakdown = {
                cgst_rate: Number(halfRate.toFixed(2)),
                cgst: Number(halfTax.toFixed(2)),
                sgst_rate: Number(halfRate.toFixed(2)),
                sgst: Number(halfTax.toFixed(2)),
                igst_rate: 0,
                igst: 0,
                cess_rate: 0,
                cess: 0,
            };
        }

        return { taxAmount, breakdown };
    }

    /**
     * Full invoice calculation pipeline.
     *
     * Flow:
     *   1. Per-line: lineTotal, discount, tax
     *   2. Subtotal = Σ lineTotals
     *   3. Document discount (on subtotal)
     *   4. Grand Total = subtotal − doc_discount + total_tax + shipping
     *   5. TDS = tds_rate% of grand total
     *   6. Round Off = nearest ₹1
     *   7. Payable = grand_total − tds + round_off
     */
    static calculate(input) {
        const lineTotals = [];

        let subtotal = new Decimal(0);
        let totalTax = new Decimal(0);
        let totalLineDiscount = new Decimal(0);

        // ── Step 1: Per-Line Calculations ─────────────────────────────────────

        for (const item of input.line_items) {
            const { lineTotal, discountAmount } = this.calculateLineTotal(
                item.quantity,
                item.unit_price,
                item.discount
            );

            const { taxAmount, breakdown } = this.calculateTaxForLine(
                lineTotal,
                item.tax_rate ?? 0,
                item.is_interstate ?? false
            );

            const lineTotalWithTax = lineTotal.plus(taxAmount);

            lineTotals.push({
                line_total: toFixed4(lineTotal),
                discount_amount: toFixed4(discountAmount),
                tax_amount: toFixed4(taxAmount),
                tax_breakdown: breakdown,
                line_total_with_tax: toFixed4(lineTotalWithTax),
            });

            subtotal = subtotal.plus(lineTotal);
            totalTax = totalTax.plus(taxAmount);
            totalLineDiscount = totalLineDiscount.plus(discountAmount);
        }

        // ── Step 2: Document-Level Discount ───────────────────────────────────

        let docDiscountAmount = new Decimal(0);
        if (input.document_discount && input.document_discount.value) {
            const discVal = toDecimal(input.document_discount.value);
            if (input.document_discount.type === 'percentage') {
                docDiscountAmount = subtotal.mul(discVal).div(100);
            } else {
                docDiscountAmount = discVal;
            }
            if (docDiscountAmount.gt(subtotal)) {
                docDiscountAmount = subtotal;
            }
        }

        const totalDiscount = totalLineDiscount.plus(docDiscountAmount);
        const discountedSubtotal = subtotal.minus(docDiscountAmount);

        // ── Step 3: Shipping ──────────────────────────────────────────────────

        const shippingCharges = toDecimal(input.shipping_charges);

        // ── Step 4: Grand Total ───────────────────────────────────────────────
        const grandTotal = discountedSubtotal.plus(totalTax).plus(shippingCharges);

        // ── Step 5: TDS ───────────────────────────────────────────────────────
        const tdsRate = toDecimal(input.tds_rate);
        const tdsAmount = grandTotal.mul(tdsRate).div(100);

        // ── Step 6: Round Off ─────────────────────────────────────────────────
        const preRound = grandTotal.minus(tdsAmount);
        const rounded = preRound.round();
        const roundOff = rounded.minus(preRound);

        // ── Step 7: Payable Amount ────────────────────────────────────────────
        const payableAmount = grandTotal.minus(tdsAmount).plus(roundOff);

        return {
            line_totals: lineTotals,
            subtotal: toFixed4(subtotal),
            total_discount: toFixed4(totalDiscount),
            total_tax: toFixed4(totalTax),
            shipping_charges: toFixed4(shippingCharges),
            grand_total: toFixed4(grandTotal),
            tds_amount: toFixed4(tdsAmount),
            round_off: toFixed4(roundOff),
            payable_amount: toFixed4(payableAmount),
        };
    }

    // ─── Payment Status Engine ─────────────────────────────────────────────────

    static calculatePaymentStatus(payableAmount, payments) {
        const payable = toDecimal(payableAmount);

        if (payable.isZero()) return 'paid';

        const totalPaid = payments
            .filter(p => !p.status || p.status === 'completed')
            .reduce((sum, p) => sum.plus(toDecimal(p.amount)), new Decimal(0));

        if (totalPaid.isZero()) return 'sent';
        if (totalPaid.gte(payable)) return 'paid';
        return 'partially_paid';
    }

    // ─── Multi-Currency Conversion ─────────────────────────────────────────────

    static convertCurrency(amount, exchangeRate, decimalPlaces = 2) {
        const amt = toDecimal(amount);
        const rate = toDecimal(exchangeRate);
        return amt.mul(rate).toFixed(decimalPlaces);
    }

    // ─── Utility: Reverse Calculate TDS ────────────────────────────────────────

    static reverseCalculateTDS(payableAfterTDS, tdsRate, taxRate) {
        const payable = toDecimal(payableAfterTDS);
        const tds = toDecimal(tdsRate);
        const tax = toDecimal(taxRate);

        const multiplier = new Decimal(1)
            .plus(tax.div(100))
            .minus(tds.div(100));

        const base = payable.div(multiplier);
        const tdsAmount = base.mul(tds).div(100);
        const taxAmount = base.mul(tax).div(100);
        const gross = base.plus(taxAmount);

        return {
            baseAmount: toFixed2(base),
            tdsAmount: toFixed2(tdsAmount),
            taxAmount: toFixed2(taxAmount),
            grossPayable: toFixed2(gross),
        };
    }

    // ─── Utility: Compute Cess ─────────────────────────────────────────────────

    static calculateCess(lineTotal, cessRate) {
        return toFixed4(toDecimal(lineTotal).mul(toDecimal(cessRate)).div(100));
    }
}

export { Decimal, toDecimal, toFixed2, toFixed4 };
