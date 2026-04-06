import { supabase } from '../../core/database/supabase.js';
import emailService from '../../core/services/email.service.js';
import { DEFAULTS } from '../../core/config/constants.js';
import { isCollectibleInvoice } from './invoiceStatus.service.js';

export const checkAndSendFollowUps = async () => {
  const now = new Date();

  // Find invoices needing follow-up
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customers!invoices_customer_id_fkey (
        id, name, email
      )
    `)
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .lt('follow_up_count', 3)
    .not('customers.email', 'is', null);

  if (error || !invoices) return;

  for (const invoice of invoices) {
    if (!isCollectibleInvoice(invoice)) continue;

    // Try to fetch org config for custom days
    const { data: config } = await supabase
      .from('organization_configs')
      .select('follow_up_day_1, follow_up_day_2, follow_up_day_3')
      .eq('organization_id', invoice.organization_id)
      .single();

    const d1 = config?.follow_up_day_1 || DEFAULTS.FOLLOW_UP_DAY_1;
    const d2 = config?.follow_up_day_2 || DEFAULTS.FOLLOW_UP_DAY_2;
    const d3 = config?.follow_up_day_3 || DEFAULTS.FOLLOW_UP_DAY_3;

    const day1Target = new Date(now - d1 * 86400000);
    const day2Target = new Date(now - d2 * 86400000);
    const day3Target = new Date(now - d3 * 86400000);

    const invoiceDate = new Date(invoice.date);
    const count = invoice.follow_up_count || 0;
    let shouldSend = false;

    if (count === 0 && invoiceDate <= day1Target) {
      shouldSend = true;
    } else if (
      count === 1 &&
      invoice.follow_up_1_sent_at &&
      new Date(invoice.follow_up_1_sent_at) <= day2Target
    ) {
      shouldSend = true;
    } else if (
      count === 2 &&
      invoice.follow_up_2_sent_at &&
      new Date(invoice.follow_up_2_sent_at) <= day3Target
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
        follow_up_last_sent_at: now.toISOString()
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
