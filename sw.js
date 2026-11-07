/* AKSon DockSlot Web Push service worker. Must be deployed at the site root as /sw.js. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = String(payload.title || 'Аксон ДокСлот').slice(0, 120);
  const body = String(payload.body || 'Появилось новое уведомление.').slice(0, 500);
  const notificationId = String(payload.notificationId || '');
  const rawUrl = String(payload.url || '/app/dashboard.html');
  let targetUrl = '/app/dashboard.html';
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) targetUrl = parsed.pathname + parsed.search + parsed.hash;
  } catch (_) { /* Keep the safe default. */ }

  const parsedTimestamp = payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now();
  const options = {
    body,
    icon: '/assets/apple-touch-icon.png',
    badge: '/assets/apple-touch-icon.png',
    tag: notificationId ? `akson-dockslot-${notificationId}` : `akson-dockslot-${Date.now()}`,
    renotify: false,
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    data: { url: targetUrl, notificationId }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/dashboard.html', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        if (typeof client.navigate === 'function') await client.navigate(target.href);
        await client.focus();
        return;
      } catch (_) { /* Try another window or open a new one. */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});
