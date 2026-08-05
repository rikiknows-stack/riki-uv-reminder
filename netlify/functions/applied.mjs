import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// רישום "מרחתי" - ההתראה הבאה נספרת מהמריחה.
// עם reset:true - ביטול הלחיצה: השעון חוזר להיספר מההתראה האחרונה.
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { endpoint, deviceId, reset } = await req.json();
    if (!endpoint && !deviceId) return json({ ok: false, reason: 'bad_request' }, 400);

    const store = getStore('riki-subs');
    const key = hash(deviceId || endpoint);
    let rec = await store.get(key, { type: 'json' }).catch(() => null);
    // תאימות לרשומות ישנות שנשמרו לפי endpoint
    let usedKey = key;
    if (!rec && endpoint) {
      usedKey = hash(endpoint);
      rec = await store.get(usedKey, { type: 'json' }).catch(() => null);
    }

    // אין רשומה = הסנכרון לא קרה. מחזירים 404 אמיתי כדי שהמסך ידע להגיד את האמת -
    // הגרסה הקודמת החזירה {ok:false} בסטטוס 200 והמסך פירש את זה כהצלחה.
    if (!rec) {
      console.log('Applied: no record found');
      return json({ ok: false, reason: 'not_found' }, 404);
    }

    rec.lastApplied = reset ? 0 : Date.now();
    await store.setJSON(usedKey, rec);
    console.log(reset ? 'Applied: reset' : 'Applied: recorded');
    return json({ ok: true, lastApplied: rec.lastApplied });
  } catch (e) {
    console.log('Applied error:', e.message);
    return json({ ok: false, reason: 'server_error' }, 500);
  }
};
