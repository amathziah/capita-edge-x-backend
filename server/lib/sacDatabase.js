/**
 * SAC (Service Accounting Code) Database
 * --------------------------------------
 * Provides mapping between SAC codes, GST rates, and TDS sections.
 * Includes auto-suggestion logic based on item descriptions.
 */

export const TDS_RATES = {
  '194J': 10,
  '194J_b': 2,
  '194C_ind': 1,
  '194C_co': 2,
  '194H': 5,
  '194I': 10,
  'self': 0,
  'none': 0,
};

export const SAC_DATABASE = {
  '998314': { code: '998314', label: 'IT / Software Development', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Tech' },
  '998313': { code: '998313', label: 'IT Consulting / Retainer', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Tech' },
  '998315': { code: '998315', label: 'IT Support / Maintenance', gstRate: 18, isExempt: false, tdsSection: '194J_b', category: 'Tech' },
  '998390': { code: '998390', label: 'Content / Creative / Design', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Creative' },
  '998391': { code: '998391', label: 'Photography / Videography', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Creative' },
  '998363': { code: '998363', label: 'Marketing / Consulting', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Marketing' },
  '998364': { code: '998364', label: 'PR / Advertising', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Marketing' },
  '998232': { code: '998232', label: 'CA / Accounting / Finance', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Finance' },
  '998231': { code: '998231', label: 'Bookkeeping', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Finance' },
  '998222': { code: '998222', label: 'GST / Tax Filing', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Finance' },
  '998212': { code: '998212', label: 'Legal Services', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Legal' },
  '998311': { code: '998311', label: 'Architecture / Engineering', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Engineering' },
  '998312': { code: '998312', label: 'Technical Testing', gstRate: 18, isExempt: false, tdsSection: '194J_b', category: 'Engineering' },
  '999293': { code: '999293', label: 'Coaching / Training / Tuition', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'Education' },
  '998411': { code: '998411', label: 'Medical / Healthcare', gstRate: 0, isExempt: true, tdsSection: '194J', category: 'Healthcare' },
  '998413': { code: '998413', label: 'Nursing / Physiotherapy', gstRate: 0, isExempt: true, tdsSection: '194J', category: 'Healthcare' },
  '999312': { code: '999312', label: 'Traditional Yoga', gstRate: 0, isExempt: true, tdsSection: '194J', category: 'Wellness' },
  '997331': { code: '997331', label: 'SaaS / Software Subscription', gstRate: 18, isExempt: false, tdsSection: '194J', category: 'SaaS' },
  '997332': { code: '997332', label: 'Cloud Computing', gstRate: 18, isExempt: false, tdsSection: '194J_b', category: 'SaaS' },
  '996211': { code: '996211', label: 'Retail Trade', gstRate: 18, isExempt: false, tdsSection: '194C_ind', category: 'Ecommerce' },
  '996111': { code: '996111', label: 'Wholesale Trade', gstRate: 18, isExempt: false, tdsSection: '194C_ind', category: 'Ecommerce' },
};

export const KEYWORD_TO_SAC = {
  'website': '998314', 'web': '998314', 'react': '998314', 'node': '998314',
  'flutter': '998314', 'mobile app': '998314', 'software': '998314',
  'frontend': '998314', 'backend': '998314', 'fullstack': '998314',
  'development': '998314', 'python': '998314', 'java': '998314',
  'ai': '998314', 'ml': '998314',
  'retainer': '998313', 'it consulting': '998313',
  'support': '998315', 'maintenance': '998315',
  'ui': '998390', 'ux': '998390', 'design': '998390', 'figma': '998390',
  'content': '998390', 'writing': '998390', 'blog': '998390', 'copywriting': '998390',
  'photo': '998391', 'photography': '998391', 'video': '998391', 'reel': '998391',
  'seo': '998363', 'marketing': '998363', 'digital marketing': '998363',
  'advertising': '998364', 'pr': '998364', 'ads': '998364',
  'accounting': '998232', 'audit': '998232', 'ca ': '998232',
  'finance': '998232', 'cfo': '998232',
  'bookkeeping': '998231',
  'gst filing': '998222', 'tax filing': '998222', 'itr': '998222', 'compliance': '998222',
  'legal': '998212', 'lawyer': '998212', 'contract': '998212', 'nda': '998212',
  'architect': '998311', 'engineering': '998311', 'civil': '998311',
  'testing': '998312', 'qa': '998312',
  'coaching': '999293', 'training': '999293', 'tuition': '999293', 'mentor': '999293',
  'medical': '998411', 'doctor': '998411', 'health': '998411',
  'clinic': '998411', 'healthcare': '998411',
  'yoga': '999312',
  'saas': '997331', 'subscription': '997331',
  'cloud': '997332', 'aws': '997332', 'azure': '997332',
};

export function getSacInfo(sacCode) {
  const clean = (sacCode ?? '').trim();
  if (SAC_DATABASE[clean]) return SAC_DATABASE[clean];
  return {
    code: clean || 'UNKNOWN',
    label: 'Professional Service',
    gstRate: 18,
    isExempt: false,
    tdsSection: '194J',
    category: 'General',
  };
}

export function autoSuggestSac(description) {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const [keyword, sacCode] of Object.entries(KEYWORD_TO_SAC)) {
    if (lower.includes(keyword)) {
      return { sacCode, entry: getSacInfo(sacCode) };
    }
  }
  return null;
}

export function getDefaultTdsSection(persona) {
  switch (persona) {
    case 'solopreneur': return '194J';
    case 'services_firm': return '194J';
    case 'ecommerce': return '194C_ind';
    case 'ca_firm': return '194J';
    case 'subscription': return '194J';
    default: return '194J';
  }
}
