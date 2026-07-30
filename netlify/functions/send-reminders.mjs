import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const UV_THRESHOLD = 3;
const REAPPLY_MS = 115 * 60 * 1000; // שעה ו-55 דק' - ההתראה מגיעה בזמן או מעט לפני, אף פעם באיחור

// המשפטים של ריקי - מתחלפים רנדומלית
const SUN_MESSAGES = [
  'UV {uv} בחוץ. הפנים שלך לא ביקשו את זה 🐆',
  'ריקי יודעת שלא חידשת. תחדשי.',
  'השמש עובדת שעות נוספות - גם הקרם שלך צריך ☀️',
  'שתי אצבעות. עכשיו. ריקי סופרת.',
  'עברו שעתיים והשמש עוד פה. את יודעת מה לעשות 🧴',
  'תזכורת ידידותית: קמטים זה לתמיד, למרוח זה 30 שניות.',
  'ה-UV עכשיו {uv}. זה לא "אולי", זה למרוח.',
  'ריקי בדקה בשבילך: השמש חזקה. הקרם - למעלה.',
  'הפסקת קרם! (זו הפסקה שבה מורחים, לא נחים) 🐆',
  'UV {uv} ואת בטח בחוץ יפה וזוהרת. תישארי ככה - תחדשי.'
];

const EVENING_MESSAGES = [
  'השמש הלכה הביתה. גם את יכולה. נתראה מחר ☀️',
  'זהו להיום - ה-UV ירד וריקי משחררת אותך. לילה טוב לעור שלך 🐆',
  'סוף משמרת לשמש. עכשיו תורו של הסרום. נתראה מחר!'
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return new Response('Missing VAPID keys', { status: 500 });
  webpush.setVapidDetails('mailto:hello@rikiknows.co.il', publicKey, privateKey);

  const store = getStore('riki-subs');
  const { blobs } = await store.list();
  if (!blobs.length) return new Response('No subscribers');

  // קיבוץ מנויות לפי מיקום מעוגל - קריאת UV אחת לכל אזור
  const uvCache = {};
  async function getUV(lat, lon) {
    const key = `${lat},${lon}`;
    if (uvCache[key] !== undefined) return uvCache[key];
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index&timezone=auto`);
      const data = await res.json();
      uvCache[key] = data.current?.uv_index ?? 0;
    } catch (e) { uvCache[key] = 0; }
    return uvCache[key];
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours() + 3; // שעון ישראל בקיץ
  let sent = 0, cleaned = 0;

  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (!rec?.subscription) continue;
    const uv = await getUV(rec.lat, rec.lon);

    let payload = null;
    const lastAction = Math.max(rec.lastNotified || 0, rec.lastApplied || 0);

    if (uv >= UV_THRESHOLD && now - lastAction >= REAPPLY_MS) {
      payload = {
        title: 'ריקי תחדשי לי 🐆',
        body: pick(SUN_MESSAGES).replace('{uv}', Math.round(uv * 10) / 10)
      };
      rec.lastNotified = now;
    } else if (uv < UV_THRESHOLD && hour >= 17 && hour <= 21 && rec.lastEveningDate !== today && rec.lastNotified > 0) {
      // הודעת ערב אחת ביום - רק למי שקיבלה תזכורות היום
      payload = { title: 'ריקי תחדשי לי 🌙', body: pick(EVENING_MESSAGES) };
      rec.lastEveningDate = today;
    }

    if (!payload) continue;

    try {
      await webpush.sendNotification(rec.subscription, JSON.stringify(payload), { urgency: 'high', TTL: 3600 });
      await store.setJSON(b.key, rec);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await store.delete(b.key); // מנוי שבוטל - מנקים
        cleaned++;
      }
    }
  }

  return new Response(`Sent ${sent}, cleaned ${cleaned}, subscribers ${blobs.length}`);
};

export const config = { schedule: '*/5 * * * *' };
