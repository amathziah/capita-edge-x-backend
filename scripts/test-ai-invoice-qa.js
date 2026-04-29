// Hits /api/ai/chat with invoice questions and prints replies for verification.

const ORG = 'f2f6add9-107d-419f-b65f-155800aa572a';
const TOKEN = 'test-token';
const URL = 'http://localhost:3000/api/ai/chat';

// Add a unique tag per question to defeat the LRU cache.
const tag = () => `[run-${Date.now()}-${Math.random().toString(36).slice(2,6)}]`;

const questions = [
  'Exact total invoice count for my org right now',
  'Sum the total field across every invoice — what is the billed total?',
  'Count of overdue invoices and the sum of their balance',
  'Top customer by total invoice amount',
  'How many invoices are still in draft status',
  'Outstanding receivables — sum of unpaid invoice balances',
  'List my 5 most recent invoices by date',
  'How much have I been paid in total — sum the paid invoices',
];

async function ask(q) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'x-active-client-id': ORG,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: `${tag()} ${q}` }),
  });
  return res.json();
}

for (const q of questions) {
  console.log('\n────────────────────────────────────────────────────────');
  console.log('Q:', q);
  try {
    const r = await ask(q);
    const text = r.text || r.message || r.response?.text || r.response?.message || JSON.stringify(r.response || r).slice(0, 500);
    console.log('A:', typeof text === 'string' ? text : JSON.stringify(text).slice(0, 800));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}
