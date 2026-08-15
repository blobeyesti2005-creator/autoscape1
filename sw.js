'use strict';

const APP_CACHE_VERSION = 'autoscape-app-v2.12.13';
const RUNTIME_CACHE = 'autoscape-runtime-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

async function migrateRuntimeEntries() {
  const keys = await caches.keys();
  const runtime = await caches.open(RUNTIME_CACHE);

  for (const key of keys) {
    if (key === APP_CACHE_VERSION || key === RUNTIME_CACHE) continue;
    if (!key.startsWith('autoscape-')) continue;

    const oldCache = await caches.open(key);
    const requests = await oldCache.keys();
    for (const request of requests) {
      const url = new URL(request.url);
      // Preserve heavyweight CDN/runtime assets across AutoScape app updates.
      if (url.origin === self.location.origin) continue;
      const response = await oldCache.match(request);
      if (response) await runtime.put(request, response.clone());
    }
  }
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await migrateRuntimeEntries();
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('autoscape-') && key !== APP_CACHE_VERSION && key !== RUNTIME_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (request.method === 'GET' && (response.ok || response.type === 'opaque')) {
    const url = new URL(request.url);
    const cacheName = url.origin === self.location.origin ? APP_CACHE_VERSION : RUNTIME_CACHE;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(APP_CACHE_VERSION);
            await cache.put('./index.html', response.clone());
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
