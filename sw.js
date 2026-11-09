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
  const notificationId = String(event.notification.data?.notificationId || '');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer an already-open DockSlot tab: tell its notification module to open
    // the inbox modal and briefly highlight the exact notification.
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        client.postMessage({ type: 'AKSON_OPEN_NOTIFICATION', notificationId });
        await client.focus();
        return;
      } catch (_) { /* Try another same-origin tab. */ }
    }
    // No open tab: launch the dashboard with a one-time instruction consumed
    // by notifications.js after the page and the user's role are initialized.
    if (self.clients.openWindow) {
      const fallback = new URL('/app/dashboard.html', self.location.origin);
      fallback.searchParams.set('openNotifications', '1');
      if (notificationId) fallback.searchParams.set('notificationId', notificationId);
      await self.clients.openWindow(fallback.href);
    }
  })());
});
