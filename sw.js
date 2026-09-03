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
    caches.open(STATIC_CACHE)
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

  // Navegação (HTML) → network-first: garante que o app não fique preso a
  // uma versão antiga em cache. Offline, cai para o index.html cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, STATIC_CACHE, './index.html'));
    return;
  }

  // Assets estáticos de mesma origem → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
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
 * Stale-while-revalidate: retorna o cache imediatamente e atualiza em
 * background. Sem cache, espera a rede. Nunca resolve para undefined —
 * offline e sem cache, responde 503.
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
