// Service Worker: zeigt Push-Meldungen an, auch wenn kein AeroTrack-Tab geöffnet ist.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'AeroTrack', body: event.data?.text() || '' };
  }
  const url = data.hex ? `/#ac/${data.hex}` : '/';
  event.waitUntil(
    self.registration.showNotification(data.title || 'AeroTrack', {
      body: data.body || '',
      tag: data.hex || 'aerotrack',
      renotify: true,
      requireInteraction: data.level === 'danger',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url, hex: data.hex || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, hex } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        if (hex) win.postMessage({ type: 'select', hex });
        return win.focus();
      }
      return self.clients.openWindow(url || '/');
    })(),
  );
});
