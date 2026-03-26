// AstralPage CRM - Service Worker
// Handles background push notifications and click actions

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Handle incoming push messages (works even when app is closed)
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title = data.title || 'AstralPage CRM';
  const opts = {
    body: data.body || '',
    icon: './astralpage_logo.svg',
    badge: './astralpage_logo.svg',
    tag: data.tag || 'crm-notif',
    renotify: false,
    vibrate: [200, 100, 200],
    data: { url: self.location.origin + '/' },
  };

  event.waitUntil(self.registration.showNotification(title, opts));
});

// Handle notification click: focus existing tab or open new one
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const match = wins.find(w => w.url && w.focused === false || w.url);
      if (match) return match.focus();
      return clients.openWindow(self.location.origin + '/');
    })
  );
});
