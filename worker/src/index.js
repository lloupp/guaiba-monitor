// index.js — Cloudflare Worker do Guaiba Monitor.
//
// Faz o que uma página estática não consegue: acordar alguém com o telefone
// bloqueado.
//
//   POST /subscribe    → guarda a inscrição de push (KV), por estação
//   POST /unsubscribe  → apaga a inscrição
//   GET  /data/:file   → realtime.json | stations.json | history.json (do KV)
//   GET  /health       → diagnóstico da última coleta
//   cron               → coleta → compara com o snapshot → envia o que mudou
//
// Privacidade (LGPD): guarda-se o endpoint de push, as chaves da própria
// inscrição e a estação escolhida. Nada de nome, telefone ou coordenada — a
// localização, quando usada, é resolvida no aparelho. Toda inscrição expira
// sozinha em SUB_TTL_DAYS dias, e /unsubscribe apaga na hora.

import {
  collectLevel,
  collectElNino,
  collectDcrsAlerts,
  collectInmetAlerts,
  buildStationCatalog,
  municipiosFromStations,
  selectTrackedStations,
  toRealtimeReading,
  HISTORY_WINDOW_HOURS,
} from '../../js/sources.js';
import { detectEvents, canSend } from '../../js/events.js';
import { importVapidKey, sendNotification } from './webpush.js';
import { normalizePlace, placesFromStationName } from '../../js/utils.js';

// Inscrição sem uso é descartada: dado pessoal guardado sem necessidade é
// risco, não funcionalidade.
const SUB_TTL_DAYS = 180;

const KEYS = {
  realtime: 'data:realtime',
  stations: 'data:stations',
  history: 'data:history',
  elnino: 'data:elnino',
  snapshot: 'state:snapshot',
  cooldown: (key) => `cooldown:${key}`,
  sub: (station, id) => `sub:${station}:${id}`,
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** Resposta JSON com CORS. */
function json(data, init = {}, origin = '*') {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin), ...(init.headers || {}) },
  });
}

/** @param {string} origin */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * A origem pode falar com este Worker?
 * @param {Request} request @param {object} env
 * @returns {string} origem liberada, ou '' quando não
 */
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const permitidas = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (permitidas.length === 0) return origin || '*';
  return permitidas.includes(origin) ? origin : '';
}

/** Identificador estável e não reversível do endpoint de push. */
async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const bytes = new Uint8Array(digest).slice(0, 16);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  /** @param {Request} request @param {object} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin || 'null') });
    }
    if (!origin) {
      return json({ error: 'origem não autorizada' }, { status: 403 }, 'null');
    }

    try {
      if (url.pathname === '/subscribe' && request.method === 'POST') {
        return await handleSubscribe(request, env, origin);
      }
      if (url.pathname === '/unsubscribe' && request.method === 'POST') {
        return await handleUnsubscribe(request, env, origin);
      }
      if (url.pathname.startsWith('/data/') && request.method === 'GET') {
        return await handleData(url, env, origin);
      }
      if (url.pathname === '/health') {
        return await handleHealth(env, origin);
      }
      return json({ error: 'rota não encontrada' }, { status: 404 }, origin);
    } catch (err) {
      console.error('[worker]', err.stack || err.message);
      return json({ error: 'erro interno' }, { status: 500 }, origin);
    }
  },

  /** Cron: coleta, detecta o que mudou e notifica. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCollection(env));
  },
};

// === Rotas ===

/** Guarda a inscrição. */
async function handleSubscribe(request, env, origin) {
  const body = await request.json().catch(() => null);
  const sub = body && body.subscription;

  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: 'inscrição inválida' }, { status: 400 }, origin);
  }
  if (!/^https:\/\//.test(sub.endpoint)) {
    return json({ error: 'endpoint precisa ser https' }, { status: 400 }, origin);
  }

  const stationCode = String(body.stationCode || 'geral').slice(0, 32);
  const id = await subscriptionId(sub.endpoint);

  const registro = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    stationCode,
    basin: body.basin ? String(body.basin).slice(0, 64) : null,
    places: Array.isArray(body.places) ? body.places.slice(0, 8).map(String) : [],
    createdAt: new Date().toISOString(),
  };

  await env.GUAIBA_KV.put(KEYS.sub(stationCode, id), JSON.stringify(registro), {
    expirationTtl: SUB_TTL_DAYS * 24 * 60 * 60,
    // metadata viaja no list(): dá para filtrar quem notificar sem ler cada valor
    metadata: { stationCode, basin: registro.basin, places: registro.places },
  });

  return json({ ok: true, id, stationCode }, {}, origin);
}

/** Apaga a inscrição. */
async function handleUnsubscribe(request, env, origin) {
  const body = await request.json().catch(() => null);
  const endpoint = body && body.endpoint;
  if (!endpoint) return json({ error: 'endpoint ausente' }, { status: 400 }, origin);

  const id = await subscriptionId(endpoint);
  // A estação pode ter mudado desde a inscrição: varre os prefixos e apaga.
  const { keys } = await env.GUAIBA_KV.list({ prefix: 'sub:' });
  const alvos = keys.filter((k) => k.name.endsWith(`:${id}`));
  await Promise.all(alvos.map((k) => env.GUAIBA_KV.delete(k.name)));

  return json({ ok: true, removidas: alvos.length }, {}, origin);
}

/** Serve os JSONs coletados (mesma forma dos arquivos do repo). */
async function handleData(url, env, origin) {
  const nome = url.pathname.replace('/data/', '').replace('.json', '');
  const chave = KEYS[nome];
  if (!chave || typeof chave !== 'string') {
    return json({ error: 'arquivo desconhecido' }, { status: 404 }, origin);
  }

  const valor = await env.GUAIBA_KV.get(chave);
  if (!valor) return json({ error: 'ainda não coletado' }, { status: 503 }, origin);

  return new Response(valor, {
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(origin),
      // Metade do intervalo do cron: nunca serve algo mais velho que a coleta.
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/** Diagnóstico simples. */
async function handleHealth(env, origin) {
  const [realtime, snapshot] = await Promise.all([
    env.GUAIBA_KV.get(KEYS.realtime, 'json'),
    env.GUAIBA_KV.get(KEYS.snapshot, 'json'),
  ]);
  const subs = await env.GUAIBA_KV.list({ prefix: 'sub:' });

  return json({
    ok: true,
    ultimaColeta: realtime?.collectedAt || null,
    estacoes: realtime?.stations?.length || 0,
    inscricoes: subs.keys.length,
    ultimoSnapshot: snapshot?.collectedAt || null,
  }, {}, origin);
}

// === Coleta + notificação ===

/**
 * Uma rodada completa: coleta, guarda, detecta e envia.
 * @param {object} env
 * @returns {Promise<object>} resumo (aparece no log do cron)
 */
export async function runCollection(env) {
  const collectedAt = new Date().toISOString();

  const [levelResult, elnino] = await Promise.all([collectLevel(), collectElNino()]);
  const stations = levelResult ? levelResult.stations : [];
  const primary = levelResult ? levelResult.primary : null;
  const municipios = municipiosFromStations(stations);
  const [dcrsAlerts, inmetAlerts] = await Promise.all([
    collectDcrsAlerts(municipios),
    collectInmetAlerts(municipios),
  ]);
  // Alertas do INMET e da Defesa Civil entram juntos na detecção de eventos.
  const alerts = [...inmetAlerts, ...dcrsAlerts];

  if (stations.length === 0) {
    console.warn('[worker] coleta sem estações — nada a notificar');
    return { ok: false, motivo: 'sem-estacoes' };
  }

  const realtime = {
    collectedAt,
    source: 'Defesa Civil RS (Rede Hidrometeorológica)',
    level: primary ? toRealtimeReading(primary) : null,
    stations: stations.map(toRealtimeReading),
    dcrsAlerts,
    inmetAlerts,
    sources: [
      'Defesa Civil RS (RSS)',
      'Defesa Civil RS (GraphQL — Rede Hidrometeorológica)',
      ...(inmetAlerts.length > 0 ? ['INMET (avisos)'] : []),
    ],
  };

  const anterior = await env.GUAIBA_KV.get(KEYS.snapshot, 'json');

  await Promise.all([
    env.GUAIBA_KV.put(KEYS.realtime, JSON.stringify(realtime)),
    env.GUAIBA_KV.put(KEYS.stations, JSON.stringify({
      collectedAt, count: stations.length, stations: buildStationCatalog(stations),
    })),
    elnino ? env.GUAIBA_KV.put(KEYS.elnino, JSON.stringify(elnino)) : Promise.resolve(),
    updateHistory(env, stations, collectedAt),
  ]);

  const thresholds = await loadThresholds(env);
  // Bacia por estação: vem da coleta (não do realtime enxuto) e é o que
  // permite avisar quem acompanha a bacia inteira, rio acima e rio abaixo.
  const bacias = new Map(stations.map((s) => [s.stationCode, s.basin || null]));
  const eventos = detectEvents(
    anterior,
    { stations: realtime.stations, alerts, collectedAt },
    {
      thresholdsFor: (code) => thresholds[code] || null,
      basinFor: (code) => bacias.get(code) || null,
    }
  );

  await env.GUAIBA_KV.put(KEYS.snapshot, JSON.stringify({
    collectedAt,
    stations: realtime.stations,
    alerts: alerts.map((a) => ({ id: a.id, severity: a.severity, source: a.source })),
  }));

  const enviados = await notify(env, eventos);

  return { ok: true, estacoes: stations.length, eventos: eventos.length, ...enviados };
}

/** Histórico das estações acompanhadas, no KV (fora do git). */
async function updateHistory(env, stations, collectedAt) {
  const atual = (await env.GUAIBA_KV.get(KEYS.history, 'json')) || { stations: {} };
  const historico = atual.stations || {};
  const corte = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000;

  for (const s of selectTrackedStations(stations)) {
    const serie = Array.isArray(historico[s.stationCode]) ? historico[s.stationCode] : [];
    const entrada = {
      timestamp: s.timestamp || collectedAt,
      levelMeters: s.levelMeters,
      trend: s.trend,
      alarmStatus: s.alarmStatus ?? null,
      rain24h: s.rain24h ?? null,
    };
    const idx = serie.findIndex((e) => e.timestamp === entrada.timestamp);
    if (idx >= 0) serie[idx] = entrada;
    else serie.push(entrada);

    historico[s.stationCode] = serie
      .filter((e) => new Date(e.timestamp).getTime() >= corte)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  await env.GUAIBA_KV.put(KEYS.history, JSON.stringify({
    collectedAt, windowHours: HISTORY_WINDOW_HOURS, stations: historico,
  }));
}

/**
 * Cotas por estação, do ref-levels.json publicado no site.
 * Falhar aqui não pode derrubar a coleta: sem cotas, a classificação por
 * alarme oficial continua funcionando.
 * @param {object} env
 * @returns {Promise<Record<string, object>>}
 */
async function loadThresholds(env) {
  if (!env.REF_LEVELS_URL) return {};
  try {
    const res = await fetch(env.REF_LEVELS_URL, { cf: { cacheTtl: 3600 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const out = {};
    for (const s of json.stations || []) {
      if (s.thresholds) out[s.id] = s.thresholds;
    }
    return out;
  } catch (err) {
    console.warn('[worker] cotas indisponíveis:', err.message);
    return {};
  }
}

/**
 * Envia os eventos para quem interessa, respeitando o cooldown.
 * @param {object} env @param {object[]} eventos
 * @returns {Promise<{enviados: number, falhas: number, removidas: number}>}
 */
async function notify(env, eventos) {
  if (eventos.length === 0) return { enviados: 0, falhas: 0, removidas: 0 };

  // Sem chaves válidas o push não sai — mas a coleta não pode cair junto: os
  // dados continuam servindo o site.
  let signingKey;
  try {
    signingKey = await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  } catch (err) {
    console.error('[worker] chaves VAPID inválidas — push desativado:', err.message);
    return { enviados: 0, falhas: eventos.length, removidas: 0, semVapid: true };
  }
  const vapid = {
    subject: env.VAPID_SUBJECT || 'mailto:contato@guaiba-monitor',
    publicKey: env.VAPID_PUBLIC_KEY,
    signingKey,
  };

  const inscricoes = await env.GUAIBA_KV.list({ prefix: 'sub:' });
  let enviados = 0;
  let falhas = 0;
  let removidas = 0;

  for (const evento of eventos) {
    const marca = await env.GUAIBA_KV.get(KEYS.cooldown(evento.key));
    if (!canSend(evento, marca ? Number(marca) : null)) continue;

    const alvos = inscricoes.keys.filter((k) => matches(k.metadata || {}, evento));
    if (alvos.length === 0) continue;

    for (const alvo of alvos) {
      const registro = await env.GUAIBA_KV.get(alvo.name, 'json');
      if (!registro) continue;

      try {
        const res = await sendNotification(registro, {
          title: evento.title,
          body: evento.body,
          tag: evento.tag,
          url: evento.url,
          severity: evento.severity,
          // O payload leva tudo que a notificação precisa mostrar: aberta
          // offline, ela ainda diz o que houve e o que fazer.
          station: evento.stationName || null,
          at: new Date().toISOString(),
        }, vapid, { urgency: evento.severity === 'emergencia' ? 'high' : 'normal' });

        if (res.ok) enviados++;
        else if (res.gone) { await env.GUAIBA_KV.delete(alvo.name); removidas++; }
        else falhas++;
      } catch (err) {
        console.warn('[worker] falha ao enviar:', err.message);
        falhas++;
      }
    }

    await env.GUAIBA_KV.put(KEYS.cooldown(evento.key), String(Date.now()), {
      expirationTtl: 7 * 24 * 60 * 60,
    });
  }

  return { enviados, falhas, removidas };
}

/**
 * A inscrição deve receber este evento?
 * Evento de estação vai para quem acompanha a estação ou a bacia dela.
 * Evento de alerta vai para quem tem a região citada.
 * @param {object} meta — metadata da inscrição
 * @param {object} evento
 * @returns {boolean}
 */
export function matches(meta, evento) {
  if (evento.stationCode) {
    if (meta.stationCode === evento.stationCode) return true;
    return Boolean(evento.basin && meta.basin && meta.basin === evento.basin);
  }

  if (evento.type === 'new_alert') {
    const regioes = (evento.regions || []).map(normalizePlace);
    if (regioes.length === 0) return true;
    if (regioes.some((r) => r === 'rio grande do sul')) return true;

    const meus = new Set();
    (meta.places || []).forEach((p) => placesFromStationName(p).forEach((x) => meus.add(normalizePlace(x))));
    return regioes.some((r) => [...meus].some((m) => r.includes(m) || m.includes(r)));
  }

  return false;
}
