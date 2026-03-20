import { InvoiceCalculator } from '../lib/financialMath.js';
import { detectGstType, getStateFromGstin } from '../lib/gstUtils.js';
import { getSacInfo, getDefaultTdsSection, TDS_RATES } from '../lib/sacDatabase.js';

export function calculateInvoiceTax(input) {

  // Step 1 — Detect GST type from GSTINs
  const gst_type = detectGstType(
    input.seller_gstin || '',
    input.buyer_gstin || '',
    {
      isEcommerce:    input.persona === 'ecommerce',
      deliveryState:  input.delivery_state || undefined,
      isLutActive:    !!input.lut_number,
      isNotRegistered: !input.is_gst_registered,
      isReverseCharge: !!input.reverse_charge,
    }
  );

  const isInterState = gst_type === 'igst';

  // Step 2 — Determine TDS section from line items
  const tdsSections = (input.items || []).map(item =>
    getSacInfo(item.sac_code || '').tdsSection
  );
  const uniqueSections = [...new Set(tdsSections)];
  const tds_section = (uniqueSections.length === 1 && uniqueSections[0])
    ? uniqueSections[0]
    : getDefaultTdsSection(input.persona || 'solopreneur');

  const tds_rate = input.tds_enabled
    ? (TDS_RATES[tds_section] ?? 10)
    : 0;

  // Step 3 — Run InvoiceCalculator
  const calcResult = InvoiceCalculator.calculate({
    line_items: (input.items || []).map(item => ({
      quantity:   Number(item.quantity) || 0,
      unit_price: Number(item.price) || 0,
      discount: (Number(item.discount_percent) > 0)
        ? { type: 'percentage', value: item.discount_percent }
        : undefined,
      tax_rate:     item.is_exempt ? 0 : (Number(item.tax_rate ?? 18) || 0),
      is_interstate: isInterState,
    })),
    document_discount: (Number(input.discount_amount) > 0)
      ? { type: 'flat', value: input.discount_amount }
      : undefined,
    shipping_charges: Number(input.shipping_charges) || 0,
    tds_rate: tds_rate,
  });

  // Step 4 — Build per-line tax results
  const line_tax_results = (input.items || []).map((item, i) => {
    const lineResult = calcResult.line_totals[i] || {};
    const breakdown  = lineResult.tax_breakdown || {};
    const effectiveRate = item.is_exempt ? 0 : (Number(item.tax_rate) ?? 18);
    const sacInfo = getSacInfo(item.sac_code || '');
    return {
      taxable_value: parseFloat(lineResult.line_total) || 0,
      tax_rate:      effectiveRate,
      cgst_rate:     isInterState ? 0 : effectiveRate / 2,
      sgst_rate:     isInterState ? 0 : effectiveRate / 2,
      igst_rate:     isInterState ? effectiveRate : 0,
      cgst_amount:   breakdown.cgst || 0,
      sgst_amount:   breakdown.sgst || 0,
      igst_amount:   breakdown.igst || 0,
      is_exempt:     !!(sacInfo.isExempt || item.is_exempt),
    };
  });

  // Step 5 — Aggregate GST totals
  const cgst_amount = gst_type === 'cgst_sgst'
    ? calcResult.line_totals.reduce((s, l) => s + (l.tax_breakdown?.cgst ?? 0), 0)
    : 0;
  const sgst_amount = gst_type === 'cgst_sgst'
    ? calcResult.line_totals.reduce((s, l) => s + (l.tax_breakdown?.sgst ?? 0), 0)
    : 0;
  const igst_amount = gst_type === 'igst'
    ? calcResult.line_totals.reduce((s, l) => s + (l.tax_breakdown?.igst ?? 0), 0)
    : 0;

  // Step 6 — Return verified result with NaN protection
  return {
    gst_type,
    tds_section,
    tds_rate,
    subtotal:       parseFloat(calcResult.subtotal) || 0,
    tax_amount:     parseFloat(calcResult.total_tax) || 0,
    cgst_amount:    cgst_amount || 0,
    sgst_amount:    sgst_amount || 0,
    igst_amount:    igst_amount || 0,
    tds_amount:     parseFloat(calcResult.tds_amount) || 0,
    net_receivable: parseFloat(calcResult.payable_amount) || 0,
    round_off:      parseFloat(calcResult.round_off) || 0,
    grand_total:    parseFloat(calcResult.grand_total) || 0,
    line_tax_results,
  };
}
