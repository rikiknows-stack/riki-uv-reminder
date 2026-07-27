self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

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
