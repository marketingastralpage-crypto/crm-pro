// AstralPage CRM - Service Worker
// Handles background push notifications, notification clicks, and email sync coordination

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

// Handle messages from the main app
self.addEventListener('message', event => {
  if (event.data?.type === 'PING_SYNC') {
    // App is checking if SW is alive — forward to all clients so sync can resume
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      wins.forEach(w => w.postMessage({ type: 'SW_READY' }));
    });
  }
});

// Background sync: triggered by the browser when connectivity is restored
self.addEventListener('sync', event => {
  if (event.tag === 'email-sync') {
    // Notify all open clients to resume the sync loop
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        wins.forEach(w => w.postMessage({ type: 'RESUME_EMAIL_SYNC' }));
      })
    );
  }
});
