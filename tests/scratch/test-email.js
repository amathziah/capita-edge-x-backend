import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

console.log('Testing SMTP Configuration:');
console.log('Host:', SMTP_HOST);
console.log('Port:', SMTP_PORT);
console.log('User:', SMTP_USER);
console.log('Pass:', SMTP_PASS ? '********' : 'NOT SET');
console.log('Secure:', SMTP_SECURE);

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT) || 587,
    secure: SMTP_SECURE === 'true',
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});

async function test() {
    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('✅ Connection verified successfully!');

        console.log('Sending test email to:', SMTP_USER);
        const info = await transporter.sendMail({
            from: `"CapitaEdgeX Test" <${SMTP_USER}>`,
            to: SMTP_USER,
            subject: 'SMTP Test Email',
            text: 'If you see this, your SMTP configuration is working!',
            html: '<b>If you see this, your SMTP configuration is working!</b>'
        });
        console.log('✅ Email sent successfully! Message ID:', info.messageId);
    } catch (error) {
        console.error('❌ SMTP Error:', error);
    }
}

test();
