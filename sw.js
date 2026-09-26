// sw.js — Service Worker do Guaiba Monitor
// PWA: instalável + funcional offline com últimos dados coletados.
//
// Estratégias de cache:
//   - Navegação (HTML): network-first, fallback cache → um deploy novo chega
//     ao usuário já no carregamento seguinte, sem depender de bump de versão.
//   - Assets estáticos (CSS, JS, ícones): stale-while-revalidate → resposta
//     instantânea offline/rede ruim, atualizando em background.
//   - Dados dinâmicos (JSONs em data/): network-first, fallback cache
//   - Leaflet (CDN): stale-while-revalidate
//
// Versionamento: bump CACHE_VERSION para descartar caches antigos de uma vez
// (troca de estratégia, asset removido). Não é necessário a cada deploy.

const CACHE_VERSION = 'guaiba-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

// Bancos de cache diferenciados por tipo de conteúdo
const CACHE_ASSETS = 'guaiba-assets-v2';
const CACHE_DATA = 'guaiba-data-v2';

// App shell — pré-cache obrigatório (mesma origem). Se qualquer um falhar,
// a instalação falha: sem eles não há app offline.
const CORE_ASSETS = [
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
];

// Pré-cache best-effort: CDN de terceiros. Só alimenta a seção El Niño, então
// uma falha aqui NÃO pode impedir a instalação do app (addAll é atômico).
const OPTIONAL_ASSETS = [
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
    caches.open(CACHE_ASSETS)
      .then(async (cache) => {
        await cache.addAll(CORE_ASSETS);
        // Terceiros: cada um por si, falha não aborta a instalação.
        await Promise.all(OPTIONAL_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[sw] pré-cache opcional falhou:', url, err.message))
        ));
      })
      .then(() => self.skipWaiting())
  );
});

// === Activate: limpa caches antigos ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_ASSETS && key !== CACHE_DATA)
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

  // Imagens → Cache-First com stale-while-revalidate
  if (req.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i)) {
    event.respondWith(staleWhileRevalidateImages(req, CACHE_ASSETS));
    return;
  }

  // Dados dinâmicos (JSONs em /data/) → Network-First com fallback para cache
  // Network-First: dados dinâmicos, prefere rede com fallback
  if (DATA_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))) {
    event.respondWith(networkFirst(req, CACHE_DATA));
    return;
  }

  // Navegação (HTML) → network-first: garante que o app não fique preso a
  // uma versão antiga em cache. Offline, cai para o index.html cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, CACHE_ASSETS, './index.html'));
    return;
  }

  // Assets estáticos de mesma origem → Cache-First
  // Cache-First: assets estáticos raramente mudam
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, CACHE_ASSETS));
    return;
  }

  // Leaflet CDN → stale-while-revalidate
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, CACHE_ASSETS));
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

/**
 * Network-first: tenta rede, se falhar usa cache. Ideal para dados e HTML.
 * @param {Request} req
 * @param {string} cacheName
 * @param {string} [offlineFallback] — recurso a servir quando nem rede nem
 *   cache da própria request respondem (ex.: './index.html' na navegação).
 */
async function networkFirst(req, cacheName, offlineFallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (offlineFallback) {
      const fallback = await cache.match(offlineFallback);
      if (fallback) return fallback;
      return new Response('Offline — recurso não disponível', { status: 503 });
    }
    return new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Cache-First: retorna do cache imediatamente, se não houver busca na rede.
 * Ideal para assets estáticos que raramente mudam. Sem cache, busca na rede.
 * @param {Request} req
 * @param {string} cacheName
 */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('Offline — recurso não disponível', { status: 503 });
  }
}

/**
 * Stale-while-revalidate: retorna o cache imediatamente e atualiza em
 * background. Sem cache, espera a rede. Nunca resolve para undefined —
 * offline e sem cache, responde 503.
 * @param {Request} req
 * @param {string} cacheName
 */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached || new Response('Offline — recurso não disponível', { status: 503 }));
  if (cached) {
    networkPromise.catch(() => {});  // revalida sem rejeitar sozinho
    return cached;
  }
  return networkPromise;
}

/**
 * Cache-First com stale-while-revalidate para imagens: retorna do cache
 * imediatamente e atualiza em background, priorizando velocidade de
 * exibição. Se sem cache, busca na rede.
 * @param {Request} req
 * @param {string} cacheName
 */
async function staleWhileRevalidateImages(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  // Retorna do cache imediatamente enquanto revalida em background
  const networkPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  if (cached) {
    networkPromise.catch(() => {});  // revalida sem rejeitar sozinho
    return cached;
  }
  return networkPromise;
}
