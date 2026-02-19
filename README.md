# Malika AI Backend

Standalone Node.js backend for the Malika AI Invoicing platform.

## Features
- REST API for Invoices, Customers, Products, and Expenses.
- Multi-lingual Invoice Generation (PDF).
- AI Assistant integration (Gemini).
- Email notifications and reminders (Nodemailer).
- Supabase integration for data storage and Auth.

## Setup

1.  **Clone this repository** (or copy folder).
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Variables**:
    Copy `.env.example` to `.env` and fill in:
    - `GEMINI_API_KEY`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_ANON_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY` (for admin tasks)
    - `SMTP_*` (for emails, or use `MOCK_EMAIL=true`)
4.  **Run Development**:
    ```bash
    npm run dev
    ```
5.  **Run Production**:
    ```bash
    npm start
    ```

## Docker
Build and run:
```bash
docker build -t malika-ai-backend .
docker run -p 3000:3000 --env-file .env malika-ai-backend
```
