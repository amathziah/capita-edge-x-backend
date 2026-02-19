
import pdfService from './server/services/pdfService.js';
import path from 'path';
import fs from 'fs';

// Mock data
const mockInvoice = {
    invoiceNumber: 'INV-TEST-001',
    createdAt: new Date().toISOString(),
    dueDate: new Date().toISOString(),
    buyer: {
        name: 'Test Buyer',
        email: 'test@example.com',
        phone: '1234567890'
    },
    items: [
        { description: 'Test Item', quantity: 1, price: 100, unit: 'pcs' }
    ],
    subtotal: 100,
    total: 100,
    status: 'draft'
};

const mockSettings = {
    businessName: 'Test Business'
};

async function testPDF() {
    console.log('Testing PDF generation...');
    try {
        const pdfPath = pdfService.getTempPDFPath(mockInvoice.invoiceNumber);
        console.log('Target path:', pdfPath);

        // Ensure temp dir exists (it might be missing if git didn't track empty folder)
        const dir = path.dirname(pdfPath);
        if (!fs.existsSync(dir)) {
            console.log('Creating temp directory:', dir);
            fs.mkdirSync(dir, { recursive: true });
        }

        await pdfService.generateInvoicePDF(mockInvoice, mockSettings, pdfPath);
        console.log('PDF generation promise resolved.');

        if (fs.existsSync(pdfPath)) {
            console.log('SUCCESS: PDF file exists at', pdfPath);
            const stats = fs.statSync(pdfPath);
            console.log('File size:', stats.size, 'bytes');
            // Clean up
            fs.unlinkSync(pdfPath);
        } else {
            console.error('FAILURE: PDF file NOT found at', pdfPath);
        }

    } catch (err) {
        console.error('PDF Generation Error:', err);
    }
}

testPDF();
