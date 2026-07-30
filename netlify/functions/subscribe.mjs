import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { subscription, lat, lon, deviceId } = await req.json();
    if (!subscription?.endpoint) return new Response('Bad request', { status: 400 });

    const store = getStore('riki-subs');
    // המפתח לפי מזהה המכשיר - רישום חוזר מאותו טלפון דורס, לא מכפיל
    const key = hash(deviceId || subscription.endpoint);
    const existing = await store.get(key, { type: 'json' }).catch(() => null);

    // ניקוי רשומה ישנה שנשמרה לפי endpoint (מהגרסה הקודמת)
    const legacyKey = hash(subscription.endpoint);
    if (legacyKey !== key) await store.delete(legacyKey).catch(() => {});

    await store.setJSON(key, {
      subscription,
      lat: Math.round((lat ?? 31.97) * 10) / 10,
      lon: Math.round((lon ?? 34.79) * 10) / 10,
      createdAt: existing?.createdAt || new Date().toISOString(),
      lastNotified: existing?.lastNotified || Date.now(),
      lastApplied: existing?.lastApplied || 0,
      lastEveningDate: existing?.lastEveningDate || ''
    });
    console.log(`Subscribe: ${existing ? 'updated' : 'new'} record`);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.log('Subscribe error:', e.message);
    return new Response('Server error', { status: 500 });
  }
};
