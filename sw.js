'use strict';

// Line Learner's service worker. It only shows rehearsal reminders (push notifications) and opens the app
// when one is tapped. It doesn't cache anything or handle page loads, so the app updates exactly as before.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch (err) { msg = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Time to rehearse', {
    body: msg.body || '',
    tag: msg.tag || undefined,
    icon: 'apple-touch-icon.png',
    data: { url: msg.url || '' },
  }));
});

// Tapping a reminder opens that script (in the app if it's already open, or a new window).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data?.url || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      w.postMessage({ openScript: id });
      return w.focus();
    }
    return self.clients.openWindow(new URL(id ? '?rehearse=' + encodeURIComponent(id) : './', self.registration.scope).href);
  })());
});
