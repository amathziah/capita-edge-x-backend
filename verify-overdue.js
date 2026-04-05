import { supabase } from './src/core/database/supabase.js';
import dotenv from 'dotenv';
dotenv.config();

async function verifyOverdueData() {
    const orgId = '7809a062-c027-4e76-a2f0-47bfb4ce9968';
    
    console.log('📡 Verifying Overdue Invoices for Malika Consulting...');
    
    // According to the app logic, an invoice is overdue if it is 'pending' and the dueDate <= today
    const now = new Date();
    
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', orgId)
        .eq('status', 'pending');

    if (error) {
        console.error('Error:', error);
        return;
    }

    const overdue = invoices.filter(inv => {
        const dueDate = new Date(inv.dueDate || inv.date); // Use invoice date if dueDate is missing
        return dueDate < now;
    }).sort((a, b) => new Date(a.dueDate || a.date) - new Date(b.dueDate || b.date));

    console.log(`--- Total Overdue: ${overdue.length} ---`);
    
    overdue.forEach(inv => {
        const dueDate = new Date(inv.dueDate || inv.date);
        const diffTime = Math.abs(now - dueDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        console.log(`Invoice: ${inv.invoiceNumber} | Amount: ₹${inv.total.toLocaleString()} | Due: ${dueDate.toLocaleDateString()} | Days Overdue: ${diffDays}`);
    });
    
    process.exit(0);
}

verifyOverdueData();
