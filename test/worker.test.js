import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import worker, { runCollection, matches } from '../worker/src/index.js';
import { toBase64Url } from '../worker/src/webpush.js';

// === KV de mentira, com o mesmo contrato do Workers KV ===
function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v.value) : v.value;
    },
    async put(key, value, opts = {}) {
      store.set(key, { value, metadata: opts.metadata || null });
    },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([name, v]) => ({ name, metadata: v.metadata })),
      };
    },
  };
}

/** Par VAPID real, no formato que o web-push gera. */
function vapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    VAPID_PUBLIC_KEY: toBase64Url(new Uint8Array(pubRaw)),
    VAPID_PRIVATE_KEY: privateKey.export({ format: 'jwk' }).d,
    VAPID_SUBJECT: 'mailto:teste@exemplo.org',
  };
}

/** Subscription de mentira com chaves P-256 reais. */
function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    endpoint,
    keys: {
      p256dh: toBase64Url(new Uint8Array(raw)),
      auth: toBase64Url(new Uint8Array(16).fill(3)),
    },
  };
}

const env = (over = {}) => ({
  GUAIBA_KV: fakeKV(),
  ALLOWED_ORIGINS: 'https://lloupp.github.io',
  ...vapidPair(),
  ...over,
});

const post = (path, body, origin = 'https://lloupp.github.io') =>
  new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });

test('inscrição é guardada por estação, com metadata para segmentar', async () => {
  const e = env();
  const sub = fakeSubscription();
  const res = await worker.fetch(post('/subscribe', {
    subscription: sub, stationCode: 'DCRS-00054', basin: 'RS - Lago Guaíba', places: ['Barra do Ribeiro'],
  }), e);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const { keys } = await e.GUAIBA_KV.list({ prefix: 'sub:' });
  assert.equal(keys.length, 1);
  assert.match(keys[0].name, /^sub:DCRS-00054:/);
  assert.equal(keys[0].metadata.basin, 'RS - Lago Guaíba');

  const guardado = await e.GUAIBA_KV.get(keys[0].name, 'json');
  assert.equal(guardado.endpoint, sub.endpoint);
  assert.equal(guardado.nome, undefined, 'nada de dado pessoal além do necessário');
});

test('inscrição inválida e origem estranha são recusadas', async () => {
  const e = env();
  const semChaves = await worker.fetch(post('/subscribe', { subscription: { endpoint: 'https://x' } }), e);
  assert.equal(semChaves.status, 400);

  const httpPuro = await worker.fetch(post('/subscribe', {
    subscription: { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } },
  }), e);
  assert.equal(httpPuro.status, 400);

  const outraOrigem = await worker.fetch(post('/subscribe', { subscription: fakeSubscription() }, 'https://site-aleatorio.com'), e);
  assert.equal(outraOrigem.status, 403);
});

test('unsubscribe apaga a inscrição mesmo se a estação mudou', async () => {
  const e = env();
  const sub = fakeSubscription();
  await worker.fetch(post('/subscribe', { subscription: sub, stationCode: 'DCRS-00054' }), e);
  await worker.fetch(post('/subscribe', { subscription: sub, stationCode: 'DCRS-00033' }), e);
  assert.equal((await e.GUAIBA_KV.list({ prefix: 'sub:' })).keys.length, 2);

  const res = await worker.fetch(post('/unsubscribe', { endpoint: sub.endpoint }), e);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).removidas, 2);
  assert.equal((await e.GUAIBA_KV.list({ prefix: 'sub:' })).keys.length, 0);
});

test('/data serve o que foi coletado e diz quando ainda não há nada', async () => {
  const e = env();
  const req = (p) => new Request(`https://worker.test${p}`, { headers: { Origin: 'https://lloupp.github.io' } });

  const vazio = await worker.fetch(req('/data/realtime.json'), e);
  assert.equal(vazio.status, 503);

  await e.GUAIBA_KV.put('data:realtime', JSON.stringify({ collectedAt: 'agora', stations: [] }));
  const cheio = await worker.fetch(req('/data/realtime.json'), e);
  assert.equal(cheio.status, 200);
  assert.equal((await cheio.json()).collectedAt, 'agora');

  const inexistente = await worker.fetch(req('/data/senhas.json'), e);
  assert.equal(inexistente.status, 404);
});

test('matches entrega o evento a quem acompanha a estação, a bacia ou a região', () => {
  const evStation = { stationCode: 'DCRS-00054', basin: 'RS - Lago Guaíba' };
  assert.equal(matches({ stationCode: 'DCRS-00054' }, evStation), true);
  assert.equal(matches({ stationCode: 'DCRS-00099' }, evStation), false);
  assert.equal(matches({ stationCode: 'X', basin: 'RS - Lago Guaíba' }, { ...evStation, basin: 'RS - Lago Guaíba' }), true);

  const evAlerta = { type: 'new_alert', regions: ['Quaraí'] };
  assert.equal(matches({ places: ['Quaraí'] }, evAlerta), true);
  assert.equal(matches({ places: ['Porto Alegre'] }, evAlerta), false);
  // alerta estadual vale para todo mundo
  assert.equal(matches({ places: ['Porto Alegre'] }, { type: 'new_alert', regions: ['Rio Grande do Sul'] }), true);
});

// === Ciclo completo do cron: coleta → detecção → push ===

/**
 * Rede de mentira. Responde às fontes reais e captura o POST de push.
 * @param {object} opts
 */
function mockFetch({ alarmStatus = 0, level = 1.5, enviados }) {
  const graphql = (codigo, nivel, alarme) => ({
    codigo,
    timestamp: new Date().toISOString(),
    name: { general: 'Barra do Ribeiro', local: 'Lago Guaíba' },
    position: { bacia: 'RS - Lago Guaíba', latitude: -30.29, longitude: -51.29, altitude: 10 },
    data: {
      rio: {
        rio_nivel: { value: nivel },
        rio_nivel_tendencia: { value: 0.01 },
        rio_alarmes: { inundacao: { status: { value: alarme }, ativo: { value: null } } },
      },
      chuva: { acumulado: { h001: { value: 0 }, h024: { value: 3.2 }, h072: { value: 8 } }, deslizamento: { h024: { status: { value: 0 } } } },
    },
  });

  return async (url, init = {}) => {
    const href = String(url);

    if (href.includes('graphql')) {
      return new Response(JSON.stringify({
        data: { tags_data: { qualle_meteorologia: [graphql('DCRS-00054', level, alarmStatus)] } },
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('/rss')) {
      return new Response('<rss><channel></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } });
    }
    if (href.includes('cpc.ncep.noaa.gov')) {
      return new Response('sem dados', { headers: { 'content-type': 'text/plain' } });
    }
    if (href.includes('ref-levels.json')) {
      return new Response(JSON.stringify({
        stations: [{ id: 'DCRS-00054', thresholds: { atencao: 1.56, inundacao: 2.60, severa: 3.50, critica: 4.50 } }],
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('fcm.googleapis.com')) {
      enviados.push({
        headers: init.headers,
        tamanhoCorpo: init.body ? init.body.length : 0,
      });
      return new Response('', { status: 201 });
    }
    throw new Error(`fetch inesperado no teste: ${href}`);
  };
}

test('ciclo do cron: primeira coleta não notifica, escalada notifica', async () => {
  const original = globalThis.fetch;
  const enviados = [];
  const e = env({ REF_LEVELS_URL: 'https://exemplo/ref-levels.json' });

  await worker.fetch(post('/subscribe', {
    subscription: fakeSubscription(),
    stationCode: 'DCRS-00054',
    basin: 'RS - Lago Guaíba',
    places: ['Barra do Ribeiro'],
  }), e);

  try {
    // 1ª rodada: nível normal. Sem baseline, ninguém é acordado.
    globalThis.fetch = mockFetch({ level: 1.5, enviados });
    const r1 = await runCollection(e);
    assert.equal(r1.ok, true);
    assert.equal(r1.eventos, 0, 'primeira coleta não gera evento');
    assert.equal(enviados.length, 0);

    // dados ficaram guardados para o site ler
    const realtime = await e.GUAIBA_KV.get('data:realtime', 'json');
    assert.equal(realtime.stations.length, 1);
    assert.equal(realtime.stations[0].levelMeters, 1.5);
    const historico = await e.GUAIBA_KV.get('data:history', 'json');
    assert.equal(historico.stations['DCRS-00054'].length, 1);

    // 2ª rodada: nível passa da cota de inundação → push
    globalThis.fetch = mockFetch({ level: 2.9, enviados });
    const r2 = await runCollection(e);
    assert.equal(r2.eventos, 1);
    assert.equal(r2.enviados, 1, 'a pessoa inscrita naquela estação recebeu');
    assert.equal(enviados.length, 1);

    const headers = enviados[0].headers;
    assert.match(headers.Authorization, /^vapid t=/, 'assinado com VAPID');
    assert.equal(headers['Content-Encoding'], 'aes128gcm', 'payload cifrado');
    assert.ok(enviados[0].tamanhoCorpo > 100, 'corpo tem conteúdo cifrado');

    // 3ª rodada: mesmo estado → cooldown segura o reenvio
    globalThis.fetch = mockFetch({ level: 2.95, enviados });
    const r3 = await runCollection(e);
    assert.equal(r3.enviados, 0, 'não repete a mesma escalada');
  } finally {
    globalThis.fetch = original;
  }
});

test('ciclo do cron: alarme oficial notifica mesmo sem cota da régua', async () => {
  const original = globalThis.fetch;
  const enviados = [];
  const e = env(); // sem REF_LEVELS_URL: nenhuma régua tem cota

  await worker.fetch(post('/subscribe', {
    subscription: fakeSubscription(), stationCode: 'DCRS-00054',
  }), e);

  try {
    globalThis.fetch = mockFetch({ level: 1.5, alarmStatus: 0, enviados });
    await runCollection(e);

    globalThis.fetch = mockFetch({ level: 1.6, alarmStatus: 2, enviados });
    const r = await runCollection(e);

    assert.equal(r.eventos, 1);
    assert.equal(r.enviados, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('inscrição morta (410) é apagada em vez de tentar para sempre', async () => {
  const original = globalThis.fetch;
  const enviados = [];
  const e = env({ REF_LEVELS_URL: 'https://exemplo/ref-levels.json' });
  await worker.fetch(post('/subscribe', { subscription: fakeSubscription(), stationCode: 'DCRS-00054' }), e);

  try {
    globalThis.fetch = mockFetch({ level: 1.5, enviados });
    await runCollection(e);

    const base = mockFetch({ level: 2.9, enviados });
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('fcm.googleapis.com')) return new Response('', { status: 410 });
      return base(url, init);
    };
    const r = await runCollection(e);

    assert.equal(r.removidas, 1);
    assert.equal((await e.GUAIBA_KV.list({ prefix: 'sub:' })).keys.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('/health não vaza endpoint nem chaves das inscrições', async () => {
  const e = env();
  await worker.fetch(post('/subscribe', { subscription: fakeSubscription(), stationCode: 'DCRS-00054' }), e);

  const res = await worker.fetch(
    new Request('https://worker.test/health', { headers: { Origin: 'https://lloupp.github.io' } }),
    e
  );
  const texto = await res.text();
  assert.match(texto, /"inscricoes":1/);
  assert.doesNotMatch(texto, /fcm\.googleapis/, 'endpoint de push não pode aparecer');
  assert.doesNotMatch(texto, /p256dh|auth/, 'chaves não podem aparecer');
});

test('quem acompanha a bacia recebe o alerta de outra estação dela', async () => {
  const original = globalThis.fetch;
  const enviados = [];
  const e = env({ REF_LEVELS_URL: 'https://exemplo/ref-levels.json' });

  // inscrição na BACIA, com outra estação escolhida
  await worker.fetch(post('/subscribe', {
    subscription: fakeSubscription(),
    stationCode: 'DCRS-00099',
    basin: 'RS - Lago Guaíba',
  }), e);

  try {
    globalThis.fetch = mockFetch({ level: 1.5, enviados });
    await runCollection(e);
    globalThis.fetch = mockFetch({ level: 2.9, enviados });
    const r = await runCollection(e);

    assert.equal(r.eventos, 1);
    assert.equal(r.enviados, 1, 'o alerta da DCRS-00054 chega a quem segue a bacia');
  } finally {
    globalThis.fetch = original;
  }
});
