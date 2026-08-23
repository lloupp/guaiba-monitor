// sw.js — Service Worker do Guaiba Monitor
// PWA: instalável, utilizável offline com os últimos dados coletados.
//
// Estratégias:
//   - Navegação (HTML): network-first → o app nunca fica preso numa versão
//     antiga; sem rede, cai para o cache.
//   - Shell (CSS/JS/ícones): cache-first DENTRO da versão → o conjunto de
//     módulos servido é sempre coerente. Misturar versões (app.js novo com
//     utils.js velho) quebra o app inteiro em ES modules; por isso o shell só
//     muda quando a versão muda, e ela muda inteira.
//   - Dados (JSONs em data/): network-first, fallback para cache.
//   - Leaflet (CDN): stale-while-revalidate.
//
// Também recebe o Web Push enviado pelo Worker (worker/src/index.js) — é o que
// permite avisar alguém com o app fechado e o telefone bloqueado.
//
// Atualização: o SW novo NÃO assume o controle sozinho (nada de skipWaiting
// automático, que troca o código no meio do uso). Ele avisa a página, que
// mostra "nova versão disponível" e só então manda SKIP_WAITING.
//
// APP_VERSION é gerado por scripts/stamp-sw.js a partir do conteúdo do shell
// (npm run stamp-sw). Não edite à mão: é essa versão que troca o cache inteiro
// de uma vez, e é por ela que a atualização chega a quem já instalou o app.

const APP_VERSION = 'va6b7261ebd';
const STATIC_CACHE = `guaiba-${APP_VERSION}-static`;
const DATA_CACHE = `guaiba-${APP_VERSION}-data`;

// App shell (pré-cache no install)
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
  './js/push.js',
  './js/leaflet-loader.js',
  './js/my-level.js',
  './js/shelters.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  // O Leaflet não entra no pré-cache: pré-baixar 150 KB de CDN na instalação
  // gasta o plano de dados de quem talvez nunca role até o mapa. Ele é
  // cacheado na primeira vez que for usado (stale-while-revalidate abaixo).
];

// JSONs coletados no servidor (network-first)
// Tudo em /data/ é network-first: cotas de referência e configuração de push
// mudam sem que o código mude, e precisam chegar sem esperar por versão nova.
const DATA_PATHS = [
  '/data/realtime.json',
  '/data/stations.json',
  '/data/history.json',
  '/data/elnino.json',
  '/data/ref-levels.json',
  '/data/push-config.json',
  '/data/shelters.json',
];

// === Install: pré-cacheia o app shell ===
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Dois cuidados aqui:
      // 1. cache: 'reload' ignora o cache HTTP do navegador. Sem isso o SW
      //    pode pré-cachear a versão ANTERIOR do arquivo (o navegador ainda a
      //    tem em max-age) e fixá-la até a próxima troca de versão.
      // 2. um a um em vez de addAll: addAll falha inteiro se um único recurso
      //    falhar (ex.: CDN fora do ar), e aí nada fica em cache.
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache
            .add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn('[sw] não cacheado:', url, err.message))
        )
      )
    )
  );
});

// === Activate: limpa caches de versões anteriores ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

// === Mensagens da página ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// === Push: notificação com o app fechado ===
//
// Este handler é o único caminho pelo qual o app alcança alguém que não está
// com ele aberto. O payload já vem completo do Worker, então a notificação se
// monta sem rede — o que importa justamente quando a rede está ruim.
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { title: 'Guaiba Monitor', body: event.data ? event.data.text() : '' };
  }

  const emergencia = dados.severity === 'emergencia';
  const options = {
    body: dados.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // tag agrupa: a segunda notificação da mesma estação substitui a primeira
    // em vez de empilhar avisos repetidos na tela de bloqueio.
    tag: dados.tag || 'guaiba',
    renotify: true,
    // Emergência não some sozinha e vibra: é para ser vista de madrugada.
    requireInteraction: emergencia,
    vibrate: emergencia ? [300, 100, 300, 100, 300] : [200, 100, 200],
    timestamp: dados.at ? Date.parse(dados.at) : Date.now(),
    data: { url: dados.url || './index.html?source=push' },
    actions: [{ action: 'abrir', title: 'Ver detalhes' }],
  };

  event.waitUntil(
    self.registration.showNotification(dados.title || 'Guaiba Monitor', options)
  );
});

// Tocar na notificação abre a aba que já existe, em vez de abrir outra.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of clientes) {
      if (cliente.url.includes(self.registration.scope) && 'focus' in cliente) {
        await cliente.focus();
        if ('navigate' in cliente) await cliente.navigate(destino).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});

// O navegador pode invalidar a inscrição sozinho; avisa a página para refazê-la.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientes.forEach((c) => c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
  })());
});

// === Fetch ===
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navegação → network-first (garante que a versão nova chegue)
  if (req.mode === 'navigate') {
    event.respondWith(navigationHandler(event));
    return;
  }

  // Dados coletados → network-first
  if (DATA_PATHS.some((p) => url.pathname.endsWith(p))) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Mesma origem (shell) → cache-first dentro da versão atual
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Leaflet via CDN → stale-while-revalidate
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // APIs externas (INMET) → sem interceptação
});

// === Estratégias ===

/** Navegação: rede primeiro, cache como rede de segurança. */
async function navigationHandler(event) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(event.request));
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch {
    const cached = (await cache.match(event.request)) || (await cache.match('./index.html'));
    if (cached) return cached;
    return new Response('Offline — abra o app uma vez com internet para usá-lo sem rede.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Network-first: ideal para dados que mudam. */
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
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Cache-first dentro da versão: o shell inteiro vem do mesmo conjunto cacheado
 * no install, então nunca há mistura de versões. Recurso ausente do cache
 * (adicionado depois) é buscado e guardado.
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
    return new Response('Offline — recurso não disponível.', { status: 503 });
  }
}

/** Stale-while-revalidate: responde do cache e atualiza em segundo plano. */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
