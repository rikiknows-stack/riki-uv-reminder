import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// רישום "מרחתי" - האפליקציה מדווחת, השרת רושם, וההתראה הבאה נספרת מהמריחה
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { endpoint } = await req.json();
    if (!endpoint) return new Response('Bad request', { status: 400 });

    const store = getStore('riki-subs');
    const key = crypto.createHash('sha256').update(endpoint).digest('hex');
    const rec = await store.get(key, { type: 'json' }).catch(() => null);
    if (!rec) return new Response(JSON.stringify({ ok: false }), { headers: { 'Content-Type': 'application/json' } });

    rec.lastApplied = Date.now();
    await store.setJSON(key, rec);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response('Server error', { status: 500 });
  }
};
