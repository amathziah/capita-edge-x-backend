
import { calculateInvoiceTax } from './server/services/taxCalculationService.js';

const mockInput = {
    items: [
        { description: "photos", quantity: 10, price: 222, tax_rate: 18 },
        { description: "videos", quantity: 1, price: 450, tax_rate: 18 }
    ],
    seller_gstin: '',
    buyer_gstin: '',
    persona: 'solopreneur',
    is_gst_registered: true
};

const result = calculateInvoiceTax(mockInput);
console.log('Calculation Result:', JSON.stringify(result, null, 2));

const inputWithUndefinedTax = {
    items: [
        { description: "photos", quantity: 10, price: 222, tax_rate: undefined }
    ],
    seller_gstin: '',
    buyer_gstin: '',
    persona: 'solopreneur'
};

const result2 = calculateInvoiceTax(inputWithUndefinedTax);
console.log('Result with Undefined Tax Rate:', result2.grand_total);
