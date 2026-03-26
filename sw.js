// AstralPage CRM - Service Worker
// Handles background notification display and click actions

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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
