// TDS Brain service worker. Its one job: when the server isn't running, show offline.html
// instead of Chrome's "can't reach this page". It never caches anything else.
const CACHE = 'tds-brain-offline-v3';
const OFFLINE_URL = '/offline.html';
const FILES = [OFFLINE_URL, '/offline.css', '/icons/brain.svg'];
// The offline page's own style and mark: network first, cached copy when the server is down.
const ASSETS = ['/offline.css', '/icons/brain.svg'];
const SKIPPED = [/^\/api(\/|$)/, /^\/auth(\/|$)/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'GET' && ASSETS.includes(url.pathname)) {
    event.respondWith(
      fetch(request).catch(() => caches.match(url.pathname).then((hit) => hit || Response.error())),
    );
    return;
  }
  if (request.mode !== 'navigate') return;
  if (SKIPPED.some((re) => re.test(url.pathname))) return;
  // Network first. Only a rejected fetch (nothing is listening) gets the offline page;
  // an HTTP error such as 401 or 500 is a real answer and passes through.
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((hit) => hit || Response.error()),
    ),
  );
});
