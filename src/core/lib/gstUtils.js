/**
 * GST (Goods and Services Tax) Utilities
 * --------------------------------------
 * Provides helper functions for GSTIN validation, state identification,
 * and GST type detection (CGST+SGST vs IGST).
 */

export const GSTIN_STATE_MAP = {
  '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UT',
  '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR',
  '11': 'SK', '18': 'AS', '19': 'WB', '20': 'JH', '21': 'OD',
  '22': 'CG', '23': 'MP', '24': 'GJ', '27': 'MH', '28': 'AP',
  '29': 'KA', '30': 'GA', '32': 'KL', '33': 'TN', '36': 'TS', '37': 'AD',
};

export const STATE_ABBR_TO_PREFIX = {
  'JK': '01', 'HP': '02', 'PB': '03', 'CH': '04', 'UT': '05',
  'HR': '06', 'DL': '07', 'RJ': '08', 'UP': '09', 'BR': '10',
  'SK': '11', 'AS': '18', 'WB': '19', 'JH': '20', 'OD': '21',
  'CG': '22', 'MP': '23', 'GJ': '24', 'MH': '27', 'AP': '28',
  'KA': '29', 'GA': '30', 'KL': '32', 'TN': '33', 'TS': '36', 'AD': '37',
};

export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function validateGstin(gstin) {
  return GSTIN_REGEX.test((gstin ?? '').trim().toUpperCase());
}

export function getStatePrefixFromGstin(gstin) {
  const clean = (gstin ?? '').trim().toUpperCase();
  if (!validateGstin(clean)) return null;
  return clean.substring(0, 2);
}

export function getStateFromGstin(gstin) {
  const prefix = getStatePrefixFromGstin(gstin);
  if (!prefix) return null;
  return GSTIN_STATE_MAP[prefix] ?? null;
}

export function getGstinStateDisplay(gstin) {
  const prefix = getStatePrefixFromGstin(gstin);
  if (!prefix) return 'Unknown';
  const abbr = GSTIN_STATE_MAP[prefix];
  if (!abbr) return 'Unknown';
  const names = {
    'MH': 'Maharashtra', 'KA': 'Karnataka', 'DL': 'Delhi',
    'TN': 'Tamil Nadu', 'GJ': 'Gujarat', 'WB': 'West Bengal',
    'TS': 'Telangana', 'UP': 'Uttar Pradesh', 'RJ': 'Rajasthan',
    'HR': 'Haryana', 'KL': 'Kerala', 'PB': 'Punjab',
    'AP': 'Andhra Pradesh', 'GA': 'Goa', 'AS': 'Assam',
    'BR': 'Bihar', 'CG': 'Chhattisgarh', 'JH': 'Jharkhand', 'MP': 'Madhya Pradesh', 'OD': 'Odisha',
  };
  return `${names[abbr] ?? abbr} (${prefix})`;
}

export function detectGstType(sellerGstin, buyerGstinOrState, options = {}) {
  if (options.isNotRegistered) return 'not_applicable';
  if (options.isLutActive) return 'igst';

  const sellerPrefix = getStatePrefixFromGstin(sellerGstin);

  let comparePrefix = null;

  if (options.isEcommerce && options.deliveryState) {
    comparePrefix = STATE_ABBR_TO_PREFIX[options.deliveryState.toUpperCase()] ?? null;
  } else if ((buyerGstinOrState ?? '').length === 15) {
    comparePrefix = getStatePrefixFromGstin(buyerGstinOrState);
  } else {
    comparePrefix = STATE_ABBR_TO_PREFIX[(buyerGstinOrState ?? '').toUpperCase()] ?? null;
  }

  if (!sellerPrefix || !comparePrefix) return 'cgst_sgst';
  return sellerPrefix === comparePrefix ? 'cgst_sgst' : 'igst';
}
