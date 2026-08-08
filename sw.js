// sw.js — Service Worker do Guaiba Monitor
// PWA: instalável + funcional offline com últimos dados coletados.
//
// Estratégias de cache:
//   - Assets estáticos (HTML, CSS, JS, ícones): cache-first, fallback network
//   - Dados dinâmicos (JSONs em data/): network-first, fallback cache
//   - Leaflet (CDN): cache-first (stale-while-revalidate)
//
// Versionamento: bump CACHE_VERSION para forçar limpeza de cache antigo.

const CACHE_VERSION = 'guaiba-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

// Assets estáticos para pré-cache (app shell)
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/utils.js',
  './js/config.js',
  './js/levels.js',
  './js/risks.js',
  './js/alerts.js',
  './js/elnino.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/ref-levels.json',
  // Leaflet via CDN
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// JSONs de dados coletados pelo Actions (network-first)
const DATA_FILES = [
  './data/realtime.json',
  './data/elnino.json',
  './data/history.json',
];

// === Install: pré-cacheia o app shell ===
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// === Activate: limpa caches antigos ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// === Fetch: roteia por estratégia ===
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Apenas GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Dados dinâmicos (JSONs em /data/) → network-first com fallback de cache
  if (DATA_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Mesma origem ou assets estáticos pré-cacheados → cache-first
  if (url.origin === self.location.origin || STATIC_ASSETS.includes(url.href)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Leaflet CDN → stale-while-revalidate
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // INMET (API externa com CORS aberto) → não interceptar, deixar o fetch normal
  if (url.hostname === 'apiprevmet3.inmet.gov.br') {
    return; // não fazer respondWith — deixa o navegador fazer o fetch normal
  }

  // Default: tentar cache, fallback network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => cached))
  );
});

// === Estratégias ===

/** Cache-first: tenta cache, se não tiver busca na rede e cacheia. */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    // Offline e sem cache — retorna página de fallback para navigation
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline — recurso não disponível', { status: 503 });
  }
}

/** Network-first: tenta rede, se falhar usa cache. Ideal para dados. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/** Stale-while-revalidate: retorna cache imediatamente, atualiza em background. */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}
