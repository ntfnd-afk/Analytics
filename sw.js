const CACHE = 'wb-dashboard-v1';
const CORE = ['/', './index.html', './app.js', './manifest.webmanifest'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // Кэшируем статику и последний ответ GViz (для оффлайна)
  if (url.origin === location.origin || url.hostname.includes('docs.google.com')) {
    e.respondWith((async ()=>{
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(e.request);
        cache.put(e.request, net.clone());
        return net;
      } catch {
        const cached = await cache.match(e.request);
        return cached || Response.error();
      }
    })());
  }
});
