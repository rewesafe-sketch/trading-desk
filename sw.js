/* Plan B: no web push endpoint. Keep a no-op service worker for future use. */
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
