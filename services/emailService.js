import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * Email Service
 * Handles sending invoices, reminders, and notifications via SMTP
 */
class EmailService {
    constructor() {
        this.transporter = null;
        this.configured = false;
        this.initializeTransporter();
    }

    /**
     * Initialize email transporter
     */
    initializeTransporter() {
        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MOCK_EMAIL } = process.env;

        if (MOCK_EMAIL === 'true') {
            console.log('📧 Mock Email Mode Enabled: Emails will be logged to console instead of sent.');
            this.configured = true;
            this.mockMode = true;
            return;
        }

        if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
            console.warn('⚠️  Default email service not configured. Set SMTP credentials in .env file.');
        } else {
            try {
                this.transporter = nodemailer.createTransport({
                    host: SMTP_HOST,
                    port: parseInt(SMTP_PORT) || 587,
                    secure: SMTP_SECURE === 'true',
                    auth: {
                        user: SMTP_USER,
                        pass: SMTP_PASS
                    }
                });
                this.configured = true;
                console.log('✅ Default email service configured successfully');
            } catch (error) {
                console.error('Email service initialization error:', error);
            }
        }
    }

    /**
     * Create dynamic transporter based on settings
     */
    createTransporter(settings = {}) {
        if (this.mockMode) return null;

        // 1. If User has provided Gmail credentials, use them
        if (settings.smtp_user && settings.smtp_pass) {
            console.log('📧 Using User Gmail Credentials for current action');
            return nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: settings.smtp_user,
                    pass: settings.smtp_pass
                }
            });
        }

        // 2. Fallback to system transporter
        if (this.configured && this.transporter) {
            return this.transporter;
        }

        throw new Error('Email service not configured. Please add Gmail credentials in settings or configure server .env.');
    }

    /**
     * Verify connection with provided settings
     */
    async verifyConnection(settings) {
        try {
            const transporter = this.createTransporter(settings);
            await transporter.verify();
            return { success: true, message: 'Connection successful' };
        } catch (error) {
            console.error('SMTP Connection verification failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send invoice email with PDF attachment
     */
    async sendInvoice(invoice, pdfPath, recipientEmail, settings = {}) {
        if (this.mockMode) {
            console.log('------ MOCK INVOICE SENT ------');
            console.log(`To: ${recipientEmail}`);
            console.log(`Subject: Invoice ${invoice.invoiceNumber}`);
            console.log('-------------------------------');
            return { success: true, messageId: `mock-invoice-${Date.now()}` };
        }
        const transporter = this.createTransporter(settings);

        // Determine "From" address
        // If using custom Gmail, "from" must match the auth user (Gmail enforces this usually)
        // If settings.smtp_user is present, use that. Otherwise fallback to env.
        const fromAddress = settings.smtp_user
            ? `"${settings.businessName || 'Business'}" <${settings.smtp_user}>`
            : `"${process.env.EMAIL_FROM_NAME || settings.businessName}" <${process.env.EMAIL_FROM}>`;

        const subject = `Invoice ${invoice.invoiceNumber} from ${settings.businessName || 'Your Business'}`;
        const html = this.generateInvoiceEmailHTML(invoice, settings);

        const mailOptions = {
            from: fromAddress,
            to: recipientEmail,
            subject: subject,
            html: html,
            attachments: []
        };

        // Attach PDF if provided
        if (pdfPath) {
            if (Buffer.isBuffer(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Invoice_${invoice.invoiceNumber}.pdf`,
                    content: pdfPath
                });
            } else if (typeof pdfPath === 'string' && fs.existsSync(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Invoice_${invoice.invoiceNumber}.pdf`,
                    path: pdfPath
                });
            }
        }

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Invoice email sent:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Email send error:', error);
            if (error.responseCode === 535 || error.code === 'EAUTH') {
                const { APIError } = await import('../middleware/errorHandler.js');
                throw new APIError('Email authentication failed. Please check your SMTP credentials in Settings or .env file.', 401);
            }
            throw error;
        }
    }

    /**
     * Send payment reminder
     */
    async sendPaymentReminder(invoice, recipientEmail, settings = {}, pdfPath = null) {
        if (this.mockMode) {
            console.log('------ MOCK REMINDER SENT ------');
            console.log(`To: ${recipientEmail}`);
            console.log(`Subject: Payment Reminder: Invoice ${invoice.invoiceNumber}`);
            console.log('--------------------------------');
            return { success: true, messageId: `mock-reminder-${Date.now()}` };
        }
        const transporter = this.createTransporter(settings);

        const fromAddress = settings.smtp_user
            ? `"${settings.businessName || 'Business'}" <${settings.smtp_user}>`
            : `"${process.env.EMAIL_FROM_NAME || settings.businessName}" <${process.env.EMAIL_FROM}>`;

        const daysOverdue = Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24));
        const subject = `Payment Reminder: Invoice ${invoice.invoiceNumber}`;
        const html = this.generateReminderEmailHTML(invoice, daysOverdue, settings);

        const mailOptions = {
            from: fromAddress,
            to: recipientEmail,
            subject: subject,
            html: html,
            attachments: []
        };

        // Attach PDF if provided
        if (pdfPath) {
            if (Buffer.isBuffer(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Invoice_${invoice.invoiceNumber}.pdf`,
                    content: pdfPath
                });
            } else if (typeof pdfPath === 'string' && fs.existsSync(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Invoice_${invoice.invoiceNumber}.pdf`,
                    path: pdfPath
                });
            }
        }

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Reminder email sent:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Reminder email error:', error);
            if (error.responseCode === 535 || error.code === 'EAUTH') {
                const { APIError } = await import('../middleware/errorHandler.js');
                throw new APIError('Email authentication failed. Please check your SMTP credentials in Settings or .env file.', 401);
            }
            throw error;
        }
    }

    /**
     * Send bulk reminders for overdue invoices
     */
    async sendBulkReminders(invoices, settings = {}) {
        const results = [];

        for (const invoice of invoices) {
            try {
                const recipientEmail = invoice.buyer?.email;
                if (!recipientEmail) {
                    results.push({ invoiceId: invoice.id, success: false, error: 'No email address' });
                    continue;
                }

                const result = await this.sendPaymentReminder(invoice, recipientEmail, settings);
                results.push({ invoiceId: invoice.id, ...result });
            } catch (error) {
                results.push({ invoiceId: invoice.id, success: false, error: error.message });
            }
        }

        return results;
    }

    /**
     * Generate invoice email HTML
     */
    generateInvoiceEmailHTML(invoice, settings) {
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .invoice-details { background: white; padding: 15px; margin: 20px 0; border-left: 4px solid #4F46E5; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${settings.businessName || 'Invoice'}</h1>
        </div>
        <div class="content">
            <p>Dear ${invoice.buyer?.name || 'Customer'},</p>
            <p>Thank you for your business! Please find attached your invoice.</p>
            
            <div class="invoice-details">
                <h3>Invoice Details</h3>
                <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
                <p><strong>Date:</strong> ${new Date(invoice.createdAt).toLocaleDateString()}</p>
                <p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
                <p><strong>Amount Due:</strong> ₹${invoice.total.toLocaleString()}</p>
            </div>

            ${settings.paymentInstructions ? `
            <div class="invoice-details">
                <h3>Payment Instructions</h3>
                <p>${settings.paymentInstructions}</p>
                ${settings.bankDetails ? `<p>${settings.bankDetails}</p>` : ''}
            </div>
            ` : ''}

            <p>If you have any questions, please don't hesitate to contact us.</p>
            <p>Best regards,<br>${settings.businessName || 'Your Business'}</p>
        </div>
        <div class="footer">
            <p>${settings.email || ''} | ${settings.phone || ''}</p>
            <p>${settings.address || ''}</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Generate reminder email HTML
     */
    generateReminderEmailHTML(invoice, daysOverdue, settings) {
        const isOverdue = daysOverdue > 0;
        const urgencyColor = isOverdue ? '#DC2626' : '#F59E0B';

        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${urgencyColor}; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .alert { background: #FEF3C7; border-left: 4px solid ${urgencyColor}; padding: 15px; margin: 20px 0; }
        .invoice-details { background: white; padding: 15px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${isOverdue ? 'Payment Overdue' : 'Payment Reminder'}</h1>
        </div>
        <div class="content">
            <p>Dear ${invoice.buyer?.name || 'Customer'},</p>
            
            ${isOverdue ? `
            <div class="alert">
                <strong>⚠️ This invoice is ${daysOverdue} days overdue.</strong>
                <p>We kindly request immediate payment to avoid any service interruption.</p>
            </div>
            ` : `
            <p>This is a friendly reminder that payment for the following invoice is due soon.</p>
            `}
            
            <div class="invoice-details">
                <h3>Invoice Details</h3>
                <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
                <p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
                <p><strong>Amount Due:</strong> ₹${invoice.total.toLocaleString()}</p>
            </div>

            ${settings.paymentInstructions ? `
            <div class="invoice-details">
                <h3>Payment Instructions</h3>
                <p>${settings.paymentInstructions}</p>
            </div>
            ` : ''}

            <p>If you have already made this payment, please disregard this reminder.</p>
            <p>Thank you for your prompt attention to this matter.</p>
            <p>Best regards,<br>${settings.businessName || 'Your Business'}</p>
        </div>
        <div class="footer">
            <p>${settings.email || ''} | ${settings.phone || ''}</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Send receipt email
     */
    async sendReceipt(invoice, pdfPath, recipientEmail, settings = {}, emailType = 'INITIAL_RECEIPT') {
        if (this.mockMode) {
            console.log('------ MOCK RECEIPT SENT ------');
            console.log(`To: ${recipientEmail}`);
            console.log(`Subject: Receipt for Invoice ${invoice.invoiceNumber}`);
            console.log('------------------------------');
            return { success: true, messageId: `mock-receipt-${Date.now()}` };
        }
        const transporter = this.createTransporter(settings);

        const fromAddress = settings.smtp_user
            ? `"${settings.businessName || 'Business'}" <${settings.smtp_user}>`
            : `"${process.env.EMAIL_FROM_NAME || settings.businessName}" <${process.env.EMAIL_FROM}>`;

        const subject = emailType === 'INITIAL_RECEIPT'
            ? `Payment Received: Invoice ${invoice.invoiceNumber}`
            : `Receipt for Invoice ${invoice.invoiceNumber}`;

        const html = this.generateReceiptEmailHTML(invoice, settings, emailType);

        const mailOptions = {
            from: fromAddress,
            to: recipientEmail,
            subject: subject,
            html: html,
            attachments: []
        };

        if (pdfPath) {
            if (Buffer.isBuffer(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Receipt_${invoice.invoiceNumber}.pdf`,
                    content: pdfPath
                });
            } else if (typeof pdfPath === 'string' && fs.existsSync(pdfPath)) {
                mailOptions.attachments.push({
                    filename: `Receipt_${invoice.invoiceNumber}.pdf`,
                    path: pdfPath
                });
            }
        }

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Receipt email sent:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Receipt email error:', error);
            if (error.responseCode === 535 || error.code === 'EAUTH') {
                const { APIError } = await import('../middleware/errorHandler.js');
                throw new APIError('Email authentication failed. Please check your SMTP credentials.', 401);
            }
            throw error;
        }
    }

    /**
     * Generate receipt email HTML
     */
    generateReceiptEmailHTML(invoice, settings, emailType) {
        // Variables
        const clientName = invoice.buyer?.name || 'Customer';
        const invoiceNumber = invoice.invoiceNumber;
        const amountPaid = `₹${(invoice.amountPaid || invoice.total).toLocaleString()}`;
        const dateOfPayment = new Date().toLocaleDateString(); // Assuming sent immediately
        const senderCompany = settings.businessName || 'Your Business';

        let bodyContent = '';

        if (emailType === 'INITIAL_RECEIPT') {
            bodyContent = `
                <p>Dear ${clientName},</p>
                <p>Thank you very much for your recent payment. We are pleased to confirm that we have received the full amount of <strong>${amountPaid}</strong> for Invoice <strong>${invoiceNumber}</strong> on ${dateOfPayment}.</p>
                <p>Your business is greatly appreciated, and we look forward to continuing our work together.</p>
                <p>Please find your official receipt attached to this email for your records.</p>
            `;
        } else {
            // RESEND_RECEIPT
            bodyContent = `
                <p>Dear ${clientName},</p>
                <p>Per your request, please find attached a copy of the receipt for Invoice <strong>${invoiceNumber}</strong>.</p>
                <p>This invoice was previously settled. The attached document is for your records.</p>
                <p>If you need any further assistance, please let us know.</p>
            `;
        }

        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
        .header h1 { color: #4F46E5; margin: 0; font-size: 24px; }
        .content { background: #fff; padding: 10px 0; }
        .footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; font-size: 12px; color: #999; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${senderCompany}</h1>
        </div>
        <div class="content">
            ${bodyContent}
            <br>
            <p>Best regards,</p>
            <p><strong>${senderCompany}</strong></p>
        </div>
        <div class="footer">
            <p>${settings.email || ''} | ${settings.phone || ''}</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Test email configuration
     */
    async testConnection(settings = null) {
        if (settings) {
            return this.verifyConnection(settings);
        }

        if (!this.configured) {
            return { success: false, error: 'Default email service not configured' };
        }

        try {
            await this.transporter.verify();
            return { success: true, message: 'Default email service is ready' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

export default new EmailService();
