// ריקי תחדשי לי - Service Worker
// שתי עבודות: קאש של המעטפת (שהאפליקציה תיפתח גם בלי רשת) והתראות פוש.
// מעלים את מספר הגרסה בכל שינוי בקבצים - זה מה שמפעיל ניקוי קאש ישן.
const CACHE = 'riki-uv-v9';

// המעטפת בלבד. נתוני UV לעולם לא נכנסים לקאש -
// נתון שמש ישן גרוע יותר מ"ריקי לא רואה את השמש כרגע".
// מקאשים כל קובץ בנפרד - קובץ חסר (למשל שם מניפסט שונה) לא מפיל את כל ההתקנה.
// addAll נכשל כולו על קובץ אחד חסר - וזה בדיוק מה שגרם למסך הלבן.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // רק הדומיין שלנו, ובלי הפונקציות - הרשמה, דיווח מריחה ונתוני UV תמיד מהרשת
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  // ניווט: קודם רשת (שתמיד יהיה עדכני), ואם אין - המעטפת מהקאש
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // שאר הקבצים: מהקאש מיד, ורענון ברקע לפעם הבאה
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'ריקי תחדשי לי', body: event.data ? event.data.text() : 'הגיע הזמן לחדש קרם הגנה' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ריקי תחדשי לי 🐆', {
      body: data.body || 'הגיע הזמן לחדש קרם הגנה',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      dir: 'rtl',
      lang: 'he',
      vibrate: [200, 100, 200],
      tag: 'riki-uv',
      renotify: true,
      data: { url: '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
