/* Service Worker: offline app shell (RT-6).
 *
 * A Web Worker or SharedWorker cannot do this job: neither can intercept
 * network requests nor serve cached responses when the VPN drops. Only a
 * Service Worker sits between the page and the network, so it caches the
 * app shell (HTML/CSS/JS) on install and serves it cache-first afterwards.
 * Uploaded meter data never leaves the device: it is only ever read with
 * File.slice into memory, never fetched, never cached, never uploaded.
 */

const CACHE = 'perdidas-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
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
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        const copy = res.clone();
        if (res.ok && new URL(request.url).origin === self.location.origin) {
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return res;
      });
    }),
  );
});
