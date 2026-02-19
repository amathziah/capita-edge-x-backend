import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * AI Service using Google Gemini API
 * Provides real AI capabilities for chatbot, magic fill, insights, and predictions
 */
class AIService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
            this.model = null;
        } else {
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getGenerativeModel({
                model: 'gemini-1.5-flash-8b',
                generationConfig: {
                    maxOutputTokens: 800 // Prevent excessively long context windows to reduce costs
                }
            });
        }
    }

    /**
     * Process chatbot query with real AI
     */
    async processQuery(query, context = {}) {
        /*
         *  INVENTORY BRAIN LOGIC
         *  If context is inventory-heavy or query implies detailed stock questions,
         *  we use the specialized "Inventory Intelligence" persona.
         */

        if (!this.model) {
            return this.fallbackProcessQuery(query, context);
        }

        try {
            const prompt = this.buildChatbotPrompt(query, context);
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Parse AI response for actions
            const action = this.extractAction(text, query);

            return {
                text: text.trim(),
                action,
                data: action ? action.data : null
            };
        } catch (error) {
            console.error('AI Query Error:', error);
            return this.fallbackProcessQuery(query, context);
        }
    }

    /**
     * Build chatbot prompt with business context
     */
    buildChatbotPrompt(query, context) {
        const { invoices = [], customers = [], products = [], stats = {} } = context;
        const lowerQuery = query.toLowerCase();

        // --------------------------------------------------
        // INVENTORY INTELLIGENCE PERSONA
        // --------------------------------------------------
        const isInventoryContext = [
            'stock', 'inventory', 'sku', 'product', 'reorder', 'selling', 'dead', 'margin', 'cost'
        ].some(k => lowerQuery.includes(k));

        if (isInventoryContext) {
            return `You are an AI Inventory Intelligence Engine.
Your job is NOT to give generic advice. Your job is to maintain inventory correctness, predict issues, and drive profitable decisions.

1. TREAT INVENTORY AS MONEY.
   - Every product has Cost (COGS), Value (Selling Price), and Holding Cost.
   - Explain numbers like a finance advisor.
   - Example: "₹3.2L is tied up in slow-moving stock."

2. STOCK HEALTH CLASSIFICATION:
   For any product discussed, classify as:
   🟢 No Action Needed
   🟡 Reorder Soon (Lead time analysis)
   🔴 Out of Stock (Critical Revenue Loss)
   🟠 Overstocked (Cash Blocked)
   ⚫ Dead Stock (No sales > 90 days)
   🔵 Seasonal (Irregular)

3. REORDER LOGIC:
   - Calculate: Avg Daily Sales, Days Remaining, Vendor Lead Time.
   - Never recommend reordering dead stock.
   - Suggest exact quantities to avoid overstocking.

4. RESPONSE STRUCTURE:
   - **Observation**: What is happening?
   - **Impact**: Money / Risk / Operations.
   - **Action**: Specific recommendation.
   - **Confidence**: High/Medium/Low.

Business Context:
- Low Stock Items: ${stats.lowStockCount || 0}
- Total Products: ${products.length}
- Inventory Value: ₹${stats.inventoryValue || 'Unknown'}

User Query: "${query}"

Answer concisely and proactively.`;
        }

        // ... existing payment/general personas ...

        // Detect Payment Context
        const isPaymentContext = [
            'pay', 'paid', 'payment', 'due', 'overdue', 'remind', 'reminder',
            'collect', 'outstanding', 'balance', 'receipt'
        ].some(keyword => lowerQuery.includes(keyword));

        if (isPaymentContext) {
            return `You are an AI Payment Workflow Assistant for an Invoice & Accounting platform.

Your ONLY responsibility is to manage everything related to PAYMENTS.

Your goals are:
- Reduce late payments
- Automate follow-ups
- Track payment status accurately
- Minimize user effort
- Optimize for local-first storage + low cloud cost

Business Context:
- Total Revenue: ₹${stats.totalRevenue || 0}
- Overdue Invoices: ${stats.overdueCount || 0}
- Pending Payments: ₹${stats.pendingPayments || 0}
- Recent Activity: ${stats.recentActivity ? JSON.stringify(stats.recentActivity) : 'None'}

User Query: "${query}"

You MUST think and respond in the following structure:

--------------------------------------------------
PAYMENT WORKFLOW THINKING MODE
--------------------------------------------------

Step 1: Detect Payment Context
Classify the user's intent into one or more of:
- Mark payment received
- Track pending payments
- Send payment reminder
- Predict late payment risk
- Partial payment handling
- Payment reconciliation
- Client payment behavior analysis

Step 2: Generate PAYMENT WORKFLOW MAP
- Break the flow into clear steps (Step 1 → Step 2 → ...)
- Include: Step name, Trigger, Execution location (LOCAL/CLOUD), AI involvement.

Step 3: Automation Rules
- Apply smart rules (e.g., Auto-mark Paid, Auto-schedule reminders).

Step 4: AI Intelligence Usage
- Use AI for detected anomalies or polite drafting. Do NOT use AI for simple storage.

--------------------------------------------------
OUTPUT FORMAT (Markdown)
--------------------------------------------------

1. **Payment Intent Detected**: <short, clear intent>

2. **Payment Workflow Map**:
   - [Step 1] → [Action]
   - [Step 2] → [Action]

3. **Execution Breakdown**:
   - **Local execution**: ...
   - **Cloud execution**: ...
   - **AI-powered actions**: ...

4. **Automation Rules Applied**:
   - <List applied rules>

5. **Risks / Missing Info**:
   - <Critical blockers only>

6. **Next Best Action**:
   - <One clear action for the user>

--------------------------------------------------
BUSINESS RULES
--------------------------------------------------
- Assume GST & invoice-based businesses
- Support partial & full payments
- Handle overdue logic carefully
- Be polite but effective in reminders
- Optimize for cash flow
- Never overwhelm the user
- Quote currency in Indian Rupees (₹)
`;
        }

        // Default: General Business Assistant
        return `You are an AI Business Assistant designed for invoicing, accounting, and operations in a local-first + cloud-sync SaaS platform.

Your primary job is to:
1. Understand the user's business intent
2. Map it to a clear workflow
3. Execute or guide each step intelligently
4. Ask only necessary follow-up questions
5. Optimize for cost, compliance, and automation

Business Context:
- Total Invoices: ${invoices.length}
- Total Customers: ${customers.length}
- Total Products: ${products.length}
- Total Revenue: ₹${stats.totalRevenue || 0}
- Overdue Invoices: ${stats.overdueCount || 0}

User Query: "${query}"

You MUST think and respond in the following structure:

--------------------------------------------------
WORKFLOW THINKING MODE
--------------------------------------------------

Step 1: Identify the user's intent
- Classify intent into one of: Invoice creation, Expense tracking, Payment follow-up, Accounting & reports, Tax/GST compliance, Client management, AI insights & forecasting, System setup or optimization

Step 2: Generate a WORKFLOW MAP
- Break the task into ordered steps (Step 1 → Step 2 → ...)
- Include: Step name, Required data, Local/Cloud execution, AI involvement

Step 3: Decide EXECUTION LOCATION
- Apply "Local-First" logic where possible for privacy and speed.

--------------------------------------------------
OUTPUT FORMAT (Markdown)
--------------------------------------------------

1. **Intent Detected**: <short clear intent>

2. **Workflow Map**:
   - [Step 1] → [Action]
   - [Step 2] → [Action]

3. **Execution Plan**:
   - **Local tasks**: ...
   - **Cloud tasks**: ...
   - **AI-powered tasks**: ...

4. **Risks / Missing Info**:
   - <List only critical blockers>

5. **Next Best Action**:
   - <One clear immediate action for the user>

--------------------------------------------------
IMPORTANT RULES
--------------------------------------------------
- Be business-aware (GST, invoices, agencies, freelancers)
- Be cost-conscious (minimize cloud usage)
- Be explainable (no black-box actions)
- Never overwhelm the user
- Prefer automation over manual steps
- Assume users are non-technical unless stated otherwise
- Quote currency in Indian Rupees (₹)
- Keep response concise despite the structure.
`;
    }

    /**
     * Extract action from AI response
     */
    extractAction(text, query) {
        const lowerQuery = query.toLowerCase();
        const lowerText = text.toLowerCase();

        // Create invoice action - Flexible Matching
        if ((lowerQuery.includes('create') && lowerQuery.includes('invoice')) || lowerQuery.includes('new invoice') || lowerQuery.includes('bill ')) {
            const nameMatch = query.match(/for\s+([A-Za-z\s]+)/i);
            return {
                type: 'open_invoice_modal',
                data: {
                    customerName: nameMatch ? nameMatch[1].trim() : ''
                }
            };
        }

        // Navigate to invoices
        if (lowerQuery.includes('show') && (lowerQuery.includes('invoice') || lowerQuery.includes('overdue'))) {
            return {
                type: 'navigate',
                data: { to: '/invoices' }
            };
        }

        return null;
    }

    /**
     * Parse invoice text with AI (Magic Fill)
     */
    async parseInvoiceText(text) {
        if (!this.model) {
            return this.fallbackParseInvoice(text);
        }

        try {
            const prompt = `Parse this invoice description into structured JSON data.

Input: "${text}"

Extract and return ONLY valid JSON with this exact structure:
{
  "buyer": { "name": "customer name or empty", "phone": "" },
  "items": [
    {
      "description": "item description",
      "quantity": number,
      "unit": "Hours|Days|Qty|Pieces",
      "price": number,
      "discount": 0
    }
  ]
}

Rules:
- Extract customer name from "for [Name]" pattern
- Identify quantities (numbers before units like hours, days, items)
- Extract prices (numbers with ₹, $, or "rupees")
- Default quantity is 1 if not specified
- Default unit is "Qty"
- Return valid JSON only, no explanations

JSON:`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let jsonText = response.text().trim();

            // Clean up response
            jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            const parsed = JSON.parse(jsonText);
            return parsed;
        } catch (error) {
            console.error('AI Parse Error:', error);
            return this.fallbackParseInvoice(text);
        }
    }

    /**
     * Generate business insights with AI
     */
    async generateInsights(context) {
        if (!this.model) {
            return this.fallbackGenerateInsights(context);
        }

        try {
            const { invoices = [], products = [], customers = [], stats = {} } = context;

            const prompt = `Analyze this business data and provide 2-3 actionable insights.

Business Metrics:
- Total Revenue: ₹${stats.totalRevenue || 0}
- Total Invoices: ${invoices.length}
- Overdue Invoices: ${stats.overdueCount || 0}
- Pending Payments: ₹${stats.pendingPayments || 0}
- Low Stock Items: ${stats.lowStockCount || 0}
- Total Customers: ${customers.length}
- Total Products: ${products.length}

Return ONLY valid JSON array with this structure:
[
  {
    "type": "suggest|warn",
    "message": "actionable insight here",
    "priority": 1-10
  }
]

Focus on:
- Cash flow issues (overdue invoices)
- Inventory alerts (low stock)
- Revenue opportunities
- Customer engagement

JSON:`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let jsonText = response.text().trim();

            jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            const insights = JSON.parse(jsonText);
            return insights.map((insight, idx) => ({
                id: `ai-${Date.now()}-${idx}`,
                type: insight.type || 'suggest',
                message: insight.message,
                priority: insight.priority || 5
            }));
        } catch (error) {
            console.error('AI Insights Error:', error);
            return this.fallbackGenerateInsights(context);
        }
    }

    /**
     * Predict revenue using linear regression
     */
    predictRevenue(historicalData) {
        if (historicalData.length < 2) return [];

        const x = historicalData.map((d, i) => i);
        const y = historicalData.map(d => d.revenue);

        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
        const sumXX = x.reduce((a, b) => a + b * b, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        const nextIdx = x[x.length - 1] + 1;
        const nextRevenue = Math.max(0, slope * nextIdx + intercept);

        return [{
            month: 'Forecast',
            revenue: Math.round(nextRevenue),
            isForecast: true,
            idx: nextIdx
        }];
    }

    /**
     * Generate Settlement Offer Email
     */
    async generateSettlementOffer(invoice) {
        if (!this.model) return null;

        const overdueDays = Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        const customerName = typeof invoice.buyer === 'string' ? JSON.parse(invoice.buyer).name : invoice.buyer?.name;

        const prompt = `Write a polite but firm payment recovery email for an invoice.
    
        Context:
        - Customer: ${customerName}
        - Invoice Amount: ₹${invoice.total}
        - Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}
        - Days Overdue: ${overdueDays}
        
        Strategy:
        - If overdue < 15 days: Gentle reminder.
        - If overdue > 30 days: Firm request.
        - If overdue > 60 days: Offer a 5% discount if paid immediately (Settlement Offer).
        
        Output JSON only:
        {
            "subject": "email subject",
            "body": "email body text",
            "discountOffered": true/false
        }`;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error) {
            console.error('AI Settlement Error:', error);
            return null;
        }
    }

    /**
     * Parse Voice Command
     */
    async parseCommand(text) {
        if (!this.model) return null;

        const prompt = `Parse this voice command into an action.
        
        Command: "${text}"
        
        Supported Actions:
        1. EXECUTE_ACTION: "Bill [Customer] [Amount]" or "Create invoice for [Customer]..."
        2. SHOW_REVENUE: "What is my revenue?" or "Show sales"
        3. LIST_OVERDUE: "Show overdue invoices" or "Who owes me money?"
        
        Output JSON:
        {
            "type": "EXECUTE_ACTION | SHOW_REVENUE | LIST_OVERDUE",
            "data": {
                "customer": "extracted name (e.g. Acme Corp)",
                "amount": number (e.g. 50000),
                "description": "extracted service description if any"
            }
        }`;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            let jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error) {
            console.error('AI Command Error:', error);
            // Fallback for demo purposes if AI fails or key invalid
            if (text.toLowerCase().includes('bill')) {
                const match = text.match(/Bill\s+(.+?)\s+(\d+)/i);
                if (match) {
                    return {
                        type: 'EXECUTE_ACTION',
                        data: { customer: match[1], amount: parseInt(match[2]), description: 'Service' }
                    };
                }
            }
            return null;
        }
    }

    /* ========== Fallback Methods (when AI not available) ========== */

    fallbackProcessQuery(query, context) {
        const q = query.toLowerCase().trim();
        const { invoices = [], customers = [], products = [], stats = {} } = context;

        // ─── GREETINGS ───
        if (/^(hi|hello|hey|sup|yo|good morning|good evening|good afternoon|what's up|howdy)\b/.test(q)) {
            const totalRev = stats.totalRevenue || 0;
            const overdueCount = stats.overdueCount || 0;
            const lowStock = stats.lowStockCount || 0;
            let greeting = "👋 Hey! Here's your business at a glance:\n\n";
            greeting += `💰 **Revenue**: ₹${totalRev.toLocaleString()}\n`;
            greeting += `📄 **Invoices**: ${invoices.length} total`;
            if (overdueCount > 0) greeting += ` (⚠️ ${overdueCount} overdue)`;
            greeting += `\n👥 **Customers**: ${customers.length}\n`;
            greeting += `📦 **Products**: ${products.length}`;
            if (lowStock > 0) greeting += ` (🔴 ${lowStock} low stock)`;
            greeting += `\n\nWhat would you like to do?`;
            return { text: greeting };
        }

        // ─── HELP / CAPABILITIES ───
        if (q.includes('help') || q.includes('what can you do') || q.includes('capabilities') || q === '?') {
            return {
                text: "Here's what I can do:\n\n" +
                    "📊 **Analytics** — \"What is my revenue?\", \"Show expenses\", \"Profit this month\"\n" +
                    "📄 **Invoices** — \"Create invoice\", \"Show overdue\", \"Pending payments\"\n" +
                    "👥 **Customers** — \"Top customers\", \"How many customers?\"\n" +
                    "📦 **Inventory** — \"Low stock items\", \"Inventory value\", \"Out of stock\"\n" +
                    "🏥 **Health** — \"Business health\", \"Cash flow\", \"GST summary\"\n" +
                    "🧾 **Quick Actions** — \"Bill [Name] [Amount]\", \"Export report\"\n\n" +
                    "Just ask in natural language!"
            };
        }

        // ─── REVENUE / SALES ───
        if (q.includes('revenue') || q.includes('sales') || q.includes('earning') || q.includes('income')) {
            const totalRev = stats.totalRevenue || 0;
            const paidInvoices = invoices.filter(i => i.status === 'paid');
            const thisMonth = new Date().getMonth();
            const thisMonthRev = paidInvoices
                .filter(i => new Date(i.created_at).getMonth() === thisMonth)
                .reduce((sum, i) => sum + (i.total || 0), 0);

            return {
                text: `💰 **Revenue Overview**\n\n` +
                    `• **Total Revenue**: ₹${totalRev.toLocaleString()}\n` +
                    `• **This Month**: ₹${thisMonthRev.toLocaleString()}\n` +
                    `• **Paid Invoices**: ${paidInvoices.length} of ${invoices.length}\n` +
                    `• **Collection Rate**: ${invoices.length > 0 ? Math.round((paidInvoices.length / invoices.length) * 100) : 0}%`,
                data: { type: 'stat', value: totalRev }
            };
        }

        // ─── EXPENSES ───
        if (q.includes('expense') || q.includes('spending') || q.includes('cost') || q.includes('spent')) {
            const totalExp = stats.totalExpenses || 0;
            return {
                text: `💸 **Expense Summary**\n\n` +
                    `• **Total Expenses**: ₹${totalExp.toLocaleString()}\n` +
                    `• **Net Profit**: ₹${((stats.totalRevenue || 0) - totalExp).toLocaleString()}\n\n` +
                    `View detailed breakdown on the Expenses page.`,
                action: { type: 'navigate', data: { to: '/expenses' } }
            };
        }

        // ─── PROFIT / MARGIN ───
        if (q.includes('profit') || q.includes('margin') || q.includes('net') || q.includes('bottom line')) {
            const rev = stats.totalRevenue || 0;
            const exp = stats.totalExpenses || 0;
            const profit = rev - exp;
            const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;
            return {
                text: `📈 **Profit Analysis**\n\n` +
                    `• **Revenue**: ₹${rev.toLocaleString()}\n` +
                    `• **Expenses**: ₹${exp.toLocaleString()}\n` +
                    `• **Net Profit**: ₹${profit.toLocaleString()}\n` +
                    `• **Margin**: ${margin}%\n\n` +
                    `${profit >= 0 ? '✅ You\'re profitable!' : '⚠️ You\'re currently at a loss.'}`,
                data: { type: 'stat', value: profit }
            };
        }

        // ─── OVERDUE INVOICES ───
        if (q.includes('overdue') || q.includes('late') || q.includes('unpaid') || q.includes('pending invoice')) {
            const overdueList = invoices.filter(i => i.status === 'overdue');
            const overdueTotal = overdueList.reduce((sum, i) => sum + (i.total || 0), 0);

            if (overdueList.length === 0) {
                return { text: '🎉 **No overdue invoices!** All payments are on track.' };
            }

            let text = `⚠️ **${overdueList.length} Overdue Invoice${overdueList.length > 1 ? 's' : ''}** — ₹${overdueTotal.toLocaleString()} outstanding\n\n`;
            overdueList.slice(0, 5).forEach(inv => {
                const buyerName = typeof inv.buyer === 'string' ? (JSON.parse(inv.buyer)?.name || 'Unknown') : (inv.buyer?.name || 'Unknown');
                text += `• **${inv.invoice_number}** — ${buyerName} — ₹${(inv.total || 0).toLocaleString()}\n`;
            });
            if (overdueList.length > 5) text += `\n...and ${overdueList.length - 5} more`;

            return {
                text,
                action: { type: 'navigate', data: { to: '/invoices' } }
            };
        }

        // ─── PENDING PAYMENTS ───
        if (q.includes('pending') || q.includes('payment') || q.includes('collect') || q.includes('receivable')) {
            const pending = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
            const pendingTotal = pending.reduce((sum, i) => sum + (i.total || 0), 0);

            return {
                text: `💳 **Pending Payments**\n\n` +
                    `• **Count**: ${pending.length} invoice${pending.length !== 1 ? 's' : ''}\n` +
                    `• **Total Outstanding**: ₹${pendingTotal.toLocaleString()}\n` +
                    `• **Sent**: ${pending.filter(i => i.status === 'sent').length}\n` +
                    `• **Overdue**: ${pending.filter(i => i.status === 'overdue').length}`,
                action: { type: 'navigate', data: { to: '/payments' } }
            };
        }

        // ─── CUSTOMERS ───
        if (q.includes('customer') || q.includes('client') || q.includes('buyer')) {
            if (q.includes('top') || q.includes('best') || q.includes('biggest') || q.includes('most')) {
                // Calculate top customers by invoice value
                const customerTotals = {};
                invoices.forEach(inv => {
                    const cId = inv.customer_id;
                    customerTotals[cId] = (customerTotals[cId] || 0) + (inv.total || 0);
                });
                const sorted = Object.entries(customerTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

                let text = `👥 **Top ${Math.min(sorted.length, 5)} Customers by Revenue**\n\n`;
                sorted.forEach(([cId, total], idx) => {
                    const cust = customers.find(c => c.id === cId);
                    text += `${idx + 1}. **${cust?.name || 'Unknown'}** — ₹${total.toLocaleString()}\n`;
                });

                return { text, action: { type: 'navigate', data: { to: '/customers' } } };
            }

            return {
                text: `👥 **Customer Summary**\n\n` +
                    `• **Total Customers**: ${customers.length}\n` +
                    `• **With Active Invoices**: ${new Set(invoices.map(i => i.customer_id)).size}\n\n` +
                    `Ask "top customers" to see your best clients.`,
                action: { type: 'navigate', data: { to: '/customers' } }
            };
        }

        // ─── INVENTORY / PRODUCTS ───
        if (q.includes('stock') || q.includes('inventory') || q.includes('product') || q.includes('item') || q.includes('sku')) {
            const lowStock = products.filter(p => p.stock <= (p.min_stock || 10));
            const outOfStock = products.filter(p => p.stock === 0);
            const totalValue = products.reduce((sum, p) => sum + (p.price * p.stock), 0);

            if (q.includes('low') || q.includes('reorder')) {
                if (lowStock.length === 0) {
                    return { text: '✅ **All products are well-stocked!** No reorders needed.' };
                }
                let text = `🔴 **${lowStock.length} Low Stock Item${lowStock.length > 1 ? 's' : ''}**\n\n`;
                lowStock.slice(0, 5).forEach(p => {
                    text += `• **${p.name}** — ${p.stock} left (min: ${p.min_stock || 10})\n`;
                });
                return { text, action: { type: 'navigate', data: { to: '/inventory' } } };
            }

            if (q.includes('out of stock') || q.includes('zero')) {
                if (outOfStock.length === 0) {
                    return { text: '✅ **No out-of-stock products!**' };
                }
                let text = `🚨 **${outOfStock.length} Out of Stock**\n\n`;
                outOfStock.slice(0, 5).forEach(p => {
                    text += `• **${p.name}** — ₹${p.price?.toLocaleString()} (selling price)\n`;
                });
                return { text, action: { type: 'navigate', data: { to: '/inventory' } } };
            }

            if (q.includes('value') || q.includes('worth')) {
                return {
                    text: `📦 **Inventory Value**: ₹${totalValue.toLocaleString()}\n\n` +
                        `• **Products**: ${products.length}\n` +
                        `• **Low Stock**: ${lowStock.length}\n` +
                        `• **Out of Stock**: ${outOfStock.length}`,
                    data: { type: 'stat', value: totalValue }
                };
            }

            return {
                text: `📦 **Inventory Overview**\n\n` +
                    `• **Total Products**: ${products.length}\n` +
                    `• **Inventory Value**: ₹${totalValue.toLocaleString()}\n` +
                    `• **Low Stock**: ${lowStock.length}\n` +
                    `• **Out of Stock**: ${outOfStock.length}\n\n` +
                    `Ask "low stock items" or "inventory value" for details.`,
                action: { type: 'navigate', data: { to: '/inventory' } }
            };
        }

        // ─── BUSINESS HEALTH / SUMMARY ───
        if (q.includes('health') || q.includes('summary') || q.includes('overview') || q.includes('dashboard') || q.includes('how is my business') || q.includes('status')) {
            const rev = stats.totalRevenue || 0;
            const exp = stats.totalExpenses || 0;
            const profit = rev - exp;
            const overdueCount = stats.overdueCount || 0;
            const lowStock = stats.lowStockCount || 0;

            let score = 100;
            if (overdueCount > 0) score -= overdueCount * 5;
            if (lowStock > 0) score -= lowStock * 3;
            if (profit < 0) score -= 20;
            score = Math.max(0, Math.min(100, score));

            let emoji = score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴';

            return {
                text: `${emoji} **Business Health Score: ${score}/100**\n\n` +
                    `💰 Revenue: ₹${rev.toLocaleString()}\n` +
                    `💸 Expenses: ₹${exp.toLocaleString()}\n` +
                    `📈 Net Profit: ₹${profit.toLocaleString()}\n` +
                    `📄 Invoices: ${invoices.length} (${overdueCount} overdue)\n` +
                    `👥 Customers: ${customers.length}\n` +
                    `📦 Products: ${products.length} (${lowStock} low stock)\n\n` +
                    `${score >= 80 ? 'Business is in great shape! 🎉' : score >= 50 ? 'Some areas need attention.' : 'Critical issues require your attention.'}`,
            };
        }

        // ─── CASH FLOW ───
        if (q.includes('cash flow') || q.includes('cashflow') || q.includes('money flow') || q.includes('liquidity')) {
            const rev = stats.totalRevenue || 0;
            const exp = stats.totalExpenses || 0;
            const pending = invoices.filter(i => i.status === 'sent' || i.status === 'overdue')
                .reduce((sum, i) => sum + (i.total || 0), 0);

            return {
                text: `💧 **Cash Flow Summary**\n\n` +
                    `• **Inflow (Collected)**: ₹${rev.toLocaleString()}\n` +
                    `• **Outflow (Expenses)**: ₹${exp.toLocaleString()}\n` +
                    `• **Awaiting Collection**: ₹${pending.toLocaleString()}\n` +
                    `• **Net Position**: ₹${(rev - exp).toLocaleString()}\n\n` +
                    `${pending > 0 ? `⚡ Collecting ₹${pending.toLocaleString()} in pending payments would improve your position.` : ''}`,
                action: { type: 'navigate', data: { to: '/reports' } }
            };
        }

        // ─── GST / TAX / COMPLIANCE ───
        if (q.includes('gst') || q.includes('tax') || q.includes('compliance') || q.includes('itc')) {
            const totalTax = invoices.reduce((sum, i) => sum + (i.tax_amount || 0), 0);
            return {
                text: `🧾 **GST Summary**\n\n` +
                    `• **Total GST Collected**: ₹${totalTax.toLocaleString()}\n` +
                    `• **Invoices with Tax**: ${invoices.filter(i => i.tax_amount > 0).length}\n\n` +
                    `Visit Compliance page for detailed filing status.`,
                action: { type: 'navigate', data: { to: '/compliance' } }
            };
        }

        // ─── RECENT ACTIVITY ───
        if (q.includes('recent') || q.includes('latest') || q.includes('today') || q.includes('this week') || q.includes('activity')) {
            const recent = invoices
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);

            if (recent.length === 0) {
                return { text: '📋 No recent activity found.' };
            }

            let text = `📋 **Recent Activity**\n\n`;
            recent.forEach(inv => {
                const buyerName = typeof inv.buyer === 'string' ? (JSON.parse(inv.buyer)?.name || 'Unknown') : (inv.buyer?.name || 'Unknown');
                const statusEmoji = { paid: '✅', sent: '📤', draft: '📝', overdue: '⚠️' }[inv.status] || '📄';
                text += `${statusEmoji} **${inv.invoice_number}** — ${buyerName} — ₹${(inv.total || 0).toLocaleString()} (${inv.status})\n`;
            });

            return { text };
        }

        // ─── INVOICE COUNT ───
        if (q.includes('how many invoice') || q.includes('invoice count') || q.includes('total invoice') || q.includes('number of invoice')) {
            const statusCounts = {};
            invoices.forEach(i => {
                statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
            });
            let text = `📄 **Invoice Summary**: ${invoices.length} total\n\n`;
            Object.entries(statusCounts).forEach(([status, count]) => {
                const emoji = { paid: '✅', sent: '📤', draft: '📝', overdue: '⚠️' }[status] || '📄';
                text += `${emoji} **${status.charAt(0).toUpperCase() + status.slice(1)}**: ${count}\n`;
            });
            return { text };
        }

        // ─── CREATE / BILL (invoice creation) ───
        if (q.includes('create') && (q.includes('invoice') || q.includes('bill'))) {
            return {
                text: '📝 Opening invoice creator...',
                action: { type: 'open_invoice_modal', data: {} }
            };
        }

        if (/^bill\s+/i.test(q)) {
            const match = query.match(/^bill\s+(.+?)\s+(\d+)/i);
            if (match) {
                return {
                    text: `📝 Drafting invoice for **${match[1]}** — ₹${parseInt(match[2]).toLocaleString()}...`,
                    action: {
                        type: 'EXECUTE_ACTION',
                        data: { customer: match[1], amount: parseInt(match[2]), description: 'Service' }
                    }
                };
            }
            return {
                text: "To quick-bill, say: **Bill [Name] [Amount]**\nExample: `Bill Acme Corp 50000`\n\nOr I can open the full invoice form.",
                action: { type: 'open_invoice_modal', data: {} }
            };
        }

        // ─── EXPORT ───
        if (q.includes('export') || q.includes('download') || q.includes('csv')) {
            return {
                text: `📥 You can export data from the **Reports** page.\n\nClick the **Export Report** button to download your invoices as CSV.`,
                action: { type: 'navigate', data: { to: '/reports' } }
            };
        }

        // ─── NAVIGATION REQUESTS ───
        const navMap = {
            'invoice': '/invoices', 'invoices': '/invoices',
            'expense': '/expenses', 'expenses': '/expenses',
            'customer': '/customers', 'customers': '/customers',
            'report': '/reports', 'reports': '/reports', 'analytics': '/reports',
            'inventory': '/inventory', 'products': '/inventory',
            'payment': '/payments', 'payments': '/payments',
            'compliance': '/compliance', 'settings': '/settings',
            'reminder': '/reminders', 'reminders': '/reminders',
        };

        if (q.includes('show') || q.includes('open') || q.includes('go to') || q.includes('navigate') || q.includes('take me')) {
            for (const [keyword, route] of Object.entries(navMap)) {
                if (q.includes(keyword)) {
                    return {
                        text: `🔗 Opening **${keyword.charAt(0).toUpperCase() + keyword.slice(1)}** page...`,
                        action: { type: 'navigate', data: { to: route } }
                    };
                }
            }
        }

        // ─── THANK YOU ───
        if (q.includes('thank') || q.includes('thanks') || q.includes('thx') || q.includes('great job') || q.includes('awesome')) {
            return { text: "You're welcome! 😊 I'm always here to help. Just ask anything about your business." };
        }

        // ─── DEFAULT (with helpful examples) ───
        return {
            text: "🤔 I'm not sure what you're looking for. Here are some things you can try:\n\n" +
                "• **\"Revenue\"** or **\"How is my business?\"** — Quick overview\n" +
                "• **\"Overdue invoices\"** — Payment follow-ups\n" +
                "• **\"Top customers\"** — Best clients by revenue\n" +
                "• **\"Low stock\"** — Inventory alerts\n" +
                "• **\"Bill Acme 50000\"** — Quick invoice\n" +
                "• **\"Business health\"** — Full health score\n" +
                "• **\"Help\"** — See all my capabilities"
        };
    }

    fallbackParseInvoice(text) {
        const result = { items: [] };
        const lower = text.toLowerCase();

        // Extract price
        const priceMatch = text.match(/[₹$]\s?(\d+(?:,\d+)*(?:\.\d+)?)/) || text.match(/(\d+)\s?(?:rupees|inr)/i);
        let price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

        // Extract quantity
        const qtyMatch = text.match(/(\d+)\s*(hours?|hrs?|days?|items?|qty)/i);
        let quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        let unit = qtyMatch ? (qtyMatch[2].toLowerCase().startsWith('hour') ? 'Hours' : 'Qty') : 'Qty';

        // Extract description
        let description = text
            .replace(/[₹$]\s?(\d+(?:,\d+)*(?:\.\d+)?)/g, '')
            .replace(/(\d+)\s*(?:hours?|hrs?|days?|items?|qty)/ig, '')
            .replace(/for\s+(.+)/i, '')
            .trim() || 'Service';

        if (price > 0) {
            result.items.push({ description, quantity, unit, price, discount: 0 });
        }

        // Extract customer
        const customerMatch = text.match(/for\s+([A-Za-z\s]+)/i);
        if (customerMatch) {
            result.buyer = { name: customerMatch[1].trim(), phone: '' };
        }

        return result;
    }

    fallbackGenerateInsights(context) {
        const insights = [];
        const { stats = {} } = context;

        if (stats.overdueCount > 0) {
            insights.push({
                id: 'overdue-warn',
                type: 'warn',
                message: `You have ${stats.overdueCount} overdue invoices. Consider sending payment reminders.`,
                priority: 1
            });
        }

        if (stats.lowStockCount > 0) {
            insights.push({
                id: 'stock-warn',
                type: 'warn',
                message: `${stats.lowStockCount} products are low on stock. Time to reorder!`,
                priority: 2
            });
        }

        if (stats.totalRevenue > 0) {
            insights.push({
                id: 'revenue-suggest',
                type: 'suggest',
                message: `Great work! You've earned ₹${stats.totalRevenue.toLocaleString()} so far.`,
                priority: 3
            });
        }

        return insights;
    }
}

export default new AIService();
