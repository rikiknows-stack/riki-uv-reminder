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

// שעה ותאריך לפי שעון ישראל אמיתי - כולל מעבר קיץ/חורף אוטומטי.
// לא UTC+3 קבוע: בחורף ישראל היא UTC+2 והחישוב הישן היה שובר את חלון הערב ואת התאריך.
function ilNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10) % 24 };
}

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return new Response('Missing VAPID keys', { status: 500 });
  webpush.setVapidDetails('mailto:hello@rikiknows.co.il', publicKey, privateKey);

  const store = getStore('riki-subs');
  const { blobs } = await store.list();
  if (!blobs.length) { console.log('No subscribers'); return new Response('No subscribers'); }

  // קיבוץ מנויות לפי מיקום מעוגל - קריאת UV אחת לכל אזור.
  // אותו מקור ואותו חישוב כמו המסך (air-quality + max), כדי שהשרת והמסך יראו את אותה שמש.
  // כשל = null, לא 0: אפס הוא נתון אמיתי (לילה), וכשל הוא "לא יודעים" - ואסור לבלבל ביניהם.
  const uvCache = {};
  async function getUV(lat, lon) {
    const key = `${lat},${lon}`;
    if (key in uvCache) return uvCache[key];
    let uv = null;
    try {
      const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=uv_index,uv_index_clear_sky&timezone=auto`);
      if (res.ok) {
        const data = await res.json();
        if (data?.current) uv = Math.max(data.current.uv_index ?? 0, data.current.uv_index_clear_sky ?? 0);
      }
    } catch (e) { /* נופלים ל-API הרגיל */ }
    if (uv === null) {
      try {
        const res2 = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index&timezone=auto`);
        if (res2.ok) {
          const data2 = await res2.json();
          if (data2?.current?.uv_index != null) uv = data2.current.uv_index;
        }
      } catch (e) { /* שני המקורות נפלו - נשארים עם null */ }
    }
    if (uv === null) console.log(`UV unavailable for zone ${key} - skipping this run`);
    uvCache[key] = uv;
    return uv;
  }

  const now = Date.now();
  const il = ilNow();
  let sent = 0, cleaned = 0, skippedNoUV = 0;

  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (!rec?.subscription) continue;

    const uv = await getUV(rec.lat, rec.lon);
    // אין נתון = לא שולחים כלום ולא נוגעים ברשומה. הסבב הבא בעוד 5 דקות ינסה שוב.
    if (uv === null) { skippedNoUV++; continue; }

    let payload = null;
    const lastAction = Math.max(rec.lastNotified || 0, rec.lastApplied || 0);

    if (uv >= UV_THRESHOLD && now - lastAction >= REAPPLY_MS) {
      payload = {
        title: 'ריקי תחדשי לי 🐆',
        body: pick(SUN_MESSAGES).replace('{uv}', Math.round(uv * 10) / 10)
      };
      rec.lastNotified = now;
      // מסמנים שהייתה תזכורת יום היום - הודעת הערב תלויה בזה
      rec.lastDayReminderDate = il.date;
    } else if (
      uv < UV_THRESHOLD &&
      il.hour >= 17 && il.hour <= 21 &&
      rec.lastEveningDate !== il.date &&
      rec.lastDayReminderDate === il.date
      // רק מי שקיבלה תזכורת יום *היום* מקבלת "לילה טוב".
      // הבדיקה הישנה (lastNotified > 0) עברה גם למי שנרשמה הרגע בערב
      // וגם למי שקיבלה תזכורת אתמול - שתיהן קיבלו הודעת ערב מיותרת.
    ) {
      payload = { title: 'ריקי תחדשי לי 🌙', body: pick(EVENING_MESSAGES) };
      rec.lastEveningDate = il.date;
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
      } else {
        // שגיאה זמנית (429/500 וכו') - הרשומה נשארת, הסבב הבא ינסה שוב.
        // לא רושמים endpoint בלוג - רק סטטוס.
        console.log(`Push failed (status ${err.statusCode ?? 'unknown'}): ${err.message ?? err}`);
      }
    }
  }

  const summary = `Sent ${sent}, cleaned ${cleaned}, skipped-no-uv ${skippedNoUV}, subscribers ${blobs.length}`;
  console.log(summary);
  return new Response(summary);
};

export const config = { schedule: '*/5 * * * *' };
