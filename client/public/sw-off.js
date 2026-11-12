// Kept ready: swap this in for sw.js and the worker removes itself and its cache.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const unregister = self.registration.unregister();
  const clear = caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  event.waitUntil(Promise.all([unregister, clear]));
});
