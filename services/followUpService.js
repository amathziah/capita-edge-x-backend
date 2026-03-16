import { supabase } from '../supabase.js';
import emailService from './emailService.js';

export const checkAndSendFollowUps = async () => {
  const now = new Date();
  const day7 = new Date(now - 7 * 86400000);
  const day14 = new Date(now - 14 * 86400000);
  const day30 = new Date(now - 30 * 86400000);

  // Find invoices needing follow-up
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customers!invoices_customer_id_fkey (
        id, name, email
      )
    `)
    .in('status', ['sent', 'overdue'])
    .lt('follow_up_count', 3)
    .not('customers.email', 'is', null);

  if (error || !invoices) return;

  for (const invoice of invoices) {
    const invoiceDate = new Date(invoice.date);
    const count = invoice.follow_up_count || 0;
    let shouldSend = false;

    if (count === 0 && invoiceDate <= day7) {
      shouldSend = true;
    } else if (
      count === 1 &&
      invoice.follow_up_1_sent_at &&
      new Date(invoice.follow_up_1_sent_at) <= day14
    ) {
      shouldSend = true;
    } else if (
      count === 2 &&
      invoice.follow_up_2_sent_at &&
      new Date(invoice.follow_up_2_sent_at) <= day30
    ) {
      shouldSend = true;
    }

    if (!shouldSend) continue;

    try {
      const customerEmail =
        invoice.customers?.email ||
        invoice.buyer?.email;
      const customerName =
        invoice.customers?.name ||
        invoice.buyer?.name ||
        'Valued Client';

      if (!customerEmail) continue;

      // Build follow-up message
      const followUpNumber = count + 1;
      const toneMap = {
        1: 'friendly and gentle',
        2: 'professional and firm',
        3: 'serious and urgent'
      };
      const tone = toneMap[followUpNumber];

      const message = `
Dear ${customerName},

This is a ${tone} reminder that invoice ${invoice.invoiceNumber} for ₹${invoice.total} was due on ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}.

Please arrange payment at your earliest convenience.

Thank you.
      `.trim();

      await emailService.sendPaymentReminder(
        invoice,
        customerEmail,
        null,
        null
      );

      // Update follow-up tracking
      const updateData = {
        follow_up_count: followUpNumber,
        follow_up_last_sent_at: now.toISOString(),
        status: 'overdue'
      };

      if (followUpNumber === 1) {
        updateData.follow_up_1_sent_at = now.toISOString();
      } else if (followUpNumber === 2) {
        updateData.follow_up_2_sent_at = now.toISOString();
      } else if (followUpNumber === 3) {
        updateData.follow_up_3_sent_at = now.toISOString();
      }

      await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', invoice.id);

      // Log to reminders table
      await supabase
        .from('reminders')
        .insert({
          organization_id: invoice.organization_id,
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          reminder_type: `follow_up_${followUpNumber}`,
          scheduled_at: now.toISOString(),
          sent_at: now.toISOString(),
          status: 'sent',
          channel: 'email'
        });

    } catch (err) {
      console.error(
        `Follow-up failed for ${invoice.invoiceNumber}:`,
        err
      );
    }
  }
};
