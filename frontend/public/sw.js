// Verve Workflow's service worker: makes the app installable, and shows push notifications.
// It does not cache anything: Verve Workflow always shows live data.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch handler is what makes browsers offer "Install"; requests go straight to the network.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Verve Workflow';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/inbox' },
    tag: data.tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/inbox', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = open.find((c) => c.url.startsWith(self.location.origin));
    if (same) { await same.focus(); return same.navigate(target); }
    return self.clients.openWindow(target);
  })());
});
