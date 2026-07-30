import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

// רישום "מרחתי" - ההתראה הבאה נספרת מהמריחה
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { endpoint, deviceId } = await req.json();
    if (!endpoint && !deviceId) return new Response('Bad request', { status: 400 });

    const store = getStore('riki-subs');
    const key = hash(deviceId || endpoint);
    let rec = await store.get(key, { type: 'json' }).catch(() => null);
    // תאימות לרשומות ישנות שנשמרו לפי endpoint
    let usedKey = key;
    if (!rec && endpoint) {
      usedKey = hash(endpoint);
      rec = await store.get(usedKey, { type: 'json' }).catch(() => null);
    }
    if (!rec) { console.log('Applied: no record found'); return new Response(JSON.stringify({ ok: false }), { headers: { 'Content-Type': 'application/json' } }); }

    rec.lastApplied = Date.now();
    await store.setJSON(usedKey, rec);
    console.log('Applied: recorded');
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.log('Applied error:', e.message);
    return new Response('Server error', { status: 500 });
  }
};
