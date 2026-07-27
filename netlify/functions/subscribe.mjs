import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { subscription, lat, lon } = await req.json();
    if (!subscription?.endpoint) return new Response('Bad request', { status: 400 });

    const store = getStore('riki-subs');
    const key = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
    await store.setJSON(key, {
      subscription,
      lat: Math.round((lat ?? 31.97) * 10) / 10,   // עיגול לק"מ בודדים - פרטיות + פחות קריאות API
      lon: Math.round((lon ?? 34.79) * 10) / 10,
      createdAt: new Date().toISOString(),
      lastNotified: 0,
      lastEveningDate: ''
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response('Server error', { status: 500 });
  }
};
