// Service worker for El Capitán PWA — enables "Add to Home Screen" / app install
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { clients.claim(); });
self.addEventListener('fetch', function(e) { e.respondWith(fetch(e.request)); });
