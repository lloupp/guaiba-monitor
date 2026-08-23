// api.js — Coleta de dados (Defesa Civil RS / INMET / NOAA)
//
// REGRA DA FASE 0: este módulo NUNCA inventa leitura. Sem dado real, devolve
// lista vazia e o motivo — quem renderiza mostra estado vazio honesto. Os
// dados de exemplo que existiam aqui foram para test/fixtures/samples.js e só
// alimentam testes.
//
// Endpoints:
//   ✓ data/realtime.json  — nível + alertas DCRS, coletados no servidor (mesma origem)
//   ✓ data/elnino.json    — anomalias de SST (NOAA CPC), coletadas no servidor
//   ✓ data/history.json   — histórico público de níveis
//   ✓ Avisos e previsão do INMET vêm dentro do realtime.json: a coleta
//     acontece no servidor porque baixar 760 KB do INMET no celular a cada
//     abertura é caro para quem mais precisa do app.

import { haversineKm } from './utils.js';

// === Política de retry e timeout ===
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 800; // ms (exponencial: 800, 1600, 3200)
const FETCH_TIMEOUT = 12000;  // 12 segundos

// De onde vêm os JSONs coletados. Por padrão, os arquivos publicados junto do
// site (GitHub Pages). Se data/push-config.json trouxer `dataUrl`, passam a vir
// do Worker — que atualiza a cada 10 min em vez de a cada commit.
// Guarda a PROMESSA, não o valor: as leituras iniciais são concorrentes
// (Promise.all), e cachear só o resultado fazia todas dispararem o mesmo fetch
// antes da primeira responder — oito requisições do mesmo arquivo na abertura.
let dataBasePromise = null;

/**
 * Resolve a origem dos dados uma vez por sessão.
 * @returns {Promise<string>} prefixo a usar nas leituras
 */
function resolveDataBase() {
  if (dataBasePromise) return dataBasePromise;
  dataBasePromise = (async () => {
    try {
      const res = await fetch('data/push-config.json', { cache: 'no-cache' });
      const cfg = res.ok ? await res.json() : null;
      return cfg && cfg.dataUrl ? String(cfg.dataUrl).replace(/\/$/, '') + '/' : 'data/';
    } catch {
      return 'data/';
    }
  })();
  return dataBasePromise;
}

/**
 * Lê um JSON coletado, da origem configurada.
 * @param {string} nome — ex.: 'realtime.json'
 * @returns {Promise<any|null>}
 */
async function fetchData(nome) {
  const base = await resolveDataBase();
  const dado = await fetchWithRetry(base + nome);
  // Worker fora do ar não pode deixar o app sem dado: cai para os arquivos
  // publicados com o site.
  if (dado === null && base !== 'data/') return fetchWithRetry('data/' + nome);
  return dado;
}

// Idade a partir da qual a leitura para de servir para disparar alerta.
// (Ela continua sendo EXIBIDA, com a idade explícita — só não gera aviso.)
const MAX_ALERT_AGE_MS = 60 * 60 * 1000; // 1 hora

/**
 * Fetch com retry exponencial e timeout via AbortController.
 * Nunca joga — retorna null em caso de falha após todas as tentativas.
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<any|null>} parsed JSON ou texto
 */
async function fetchWithRetry(url, options = {}) {
  const opts = { ...options };

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const signalOpts = { ...opts, signal: controller.signal };

    try {
      const response = await fetch(url, signalOpts);
      clearTimeout(timeoutId);

      if (!response.ok) {
        // 4xx é resposta definitiva: repetir só gasta tempo e bateria.
        if (response.status >= 400 && response.status < 500) {
          console.warn(`[api] ${url} → HTTP ${response.status} (sem retry)`);
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers?.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === RETRY_ATTEMPTS) {
        console.warn(`[api] Falha após ${RETRY_ATTEMPTS} tentativas: ${url}`, err.message);
        return null;
      }
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

// === Idade dos dados ===

/**
 * Idade de um timestamp ISO em milissegundos.
 * @param {string} iso
 * @returns {number|null} null se o timestamp for inválido
 */
function ageMs(iso) {
  if (!iso) return null;
  const age = Date.now() - new Date(iso).getTime();
  return Number.isNaN(age) ? null : age;
}

/**
 * A leitura é recente o suficiente para DISPARAR alerta?
 * Não use para decidir exibição — dado velho é exibido com a idade à mostra.
 * @param {string} iso
 * @param {number} [maxAge]
 * @returns {boolean}
 */
function isFresh(iso, maxAge = MAX_ALERT_AGE_MS) {
  const age = ageMs(iso);
  return age != null && age >= 0 && age < maxAge;
}

// === Coletas ===

/**
 * Converte uma estação do realtime.json para o formato LevelReading.
 * @param {object} s
 * @param {string} collectedAt
 * @returns {object}
 */
function toLevelReading(s, collectedAt, defaults = {}) {
  return {
    id: s.stationCode,
    station: s.stationCode,
    location: s.stationName || s.stationCode,
    levelMeters: parseFloat(s.levelMeters),
    trend: typeof s.trend === 'number'
      ? (s.trend > 0.005 ? 'subindo' : s.trend < -0.005 ? 'descendo' : 'estavel')
      : (typeof s.trend === 'string' ? s.trend : 'estavel'),
    trendValue: typeof s.trend === 'number' ? s.trend : null,
    // Alarme oficial de inundação publicado pela DCRS (0 = sem alarme).
    alarmStatus: s.alarmStatus != null ? s.alarmStatus : null,
    rain1h: s.rain1h ?? null,
    rain24h: s.rain24h ?? null,
    rain72h: s.rain72h ?? null,
    landslideStatus: s.landslideStatus ?? null,
    // Bacia e coordenadas vêm do catálogo (data/stations.json).
    basin: defaults.basin || null,
    basinInferred: defaults.basinInferred === true,
    latitude: defaults.latitude ?? null,
    longitude: defaults.longitude ?? null,
    recordedAt: s.timestamp || collectedAt,
    source: s.source || defaults.source || 'Defesa Civil RS',
  };
}

/**
 * Busca o nível coletado no servidor (data/realtime.json).
 * Sem dado real, devolve lista vazia e o motivo — nunca leitura inventada.
 * @returns {Promise<{stations: object[], source: string|null, collectedAt: string|null, ageMs: number|null, unavailable: boolean}>}
 */
async function fetchLevelGuaiba() {
  const [rt, catalog] = await Promise.all([fetchRealtime(), fetchStations()]);
  const readings = rt && (Array.isArray(rt.stations) ? rt.stations : (rt.level ? [rt.level] : []));

  if (!readings || readings.length === 0) {
    return {
      stations: [],
      source: null,
      collectedAt: (rt && rt.collectedAt) || null,
      ageMs: rt ? ageMs(rt.collectedAt) : null,
      unavailable: true,
      reason: rt ? 'coleta-sem-nivel' : 'sem-conexao',
    };
  }

  const byCode = new Map(
    ((catalog && catalog.stations) || []).map((c) => [c.code, c])
  );
  const defaults = { source: rt.source };

  const stations = readings
    .filter((s) => s && s.levelMeters != null)
    .map((s) => toLevelReading(s, rt.collectedAt, { ...defaults, ...(byCode.get(s.stationCode) || {}) }));

  return {
    stations,
    primaryCode: rt.level ? rt.level.stationCode : (stations[0] && stations[0].station),
    source: rt.source || 'Defesa Civil RS',
    collectedAt: rt.collectedAt,
    ageMs: ageMs(rt.collectedAt),
    unavailable: false,
  };
}

/**
 * Avisos do INMET, já coletados e filtrados no servidor.
 *
 * Antes o app buscava `apiprevmet3.inmet.gov.br/avisos/ativos` direto do
 * navegador: 540 KB sem compressão, com os avisos do Brasil inteiro, para
 * exibir alguns do RS. Em plano de dados de quem está numa emergência, isso é
 * caro demais — a coleta foi para o servidor (js/sources.js).
 *
 * @returns {Promise<{alerts: object[], source: string|null, unavailable: boolean}>}
 */
async function fetchINMETAlertas() {
  const rt = await fetchRealtime();
  if (!rt) return { alerts: [], source: null, unavailable: true };
  const alerts = Array.isArray(rt.inmetAlerts) ? rt.inmetAlerts : [];
  return { alerts, source: 'INMET', unavailable: false };
}

/**
 * Alertas da Defesa Civil RS, coletados no servidor via RSS.
 * @returns {Promise<{alerts: object[], source: string|null, unavailable: boolean}>}
 */
async function fetchDCRSAlertas() {
  const rt = await fetchRealtime();
  if (!rt) return { alerts: [], source: null, unavailable: true };
  const alerts = Array.isArray(rt.dcrsAlerts) ? rt.dcrsAlerts : [];
  return { alerts, source: 'Defesa Civil RS (RSS)', unavailable: false };
}

// === Dados coletados no servidor (mesma origem, sem CORS) ===

let realtimeCache = null;
let elninoCache = null;
let historyCache = null;
let stationsCache = null;
let sheltersCache = null;

/**
 * Lê data/realtime.json (nível + alertas DCRS). Cache por sessão.
 * @param {boolean} [force]
 * @returns {Promise<object|null>}
 */
async function fetchRealtime(force = false) {
  if (realtimeCache && !force) return realtimeCache;
  realtimeCache = await fetchData('realtime.json');
  return realtimeCache;
}

/**
 * Lê data/stations.json — catálogo das estações (nome, bacia, coordenadas).
 * Muda raramente, então o cache de sessão basta.
 * @param {boolean} [force]
 * @returns {Promise<object|null>}
 */
async function fetchStations(force = false) {
  if (stationsCache && !force) return stationsCache;
  stationsCache = await fetchData('stations.json');
  return stationsCache;
}

/**
 * Estação mais próxima de uma coordenada, pelo catálogo.
 * @param {object[]} catalog — stations do data/stations.json
 * @param {number} lat
 * @param {number} lon
 * @returns {{station: object, distanceKm: number}|null}
 */
function nearestStation(catalog, lat, lon) {
  if (!Array.isArray(catalog) || lat == null || lon == null) return null;
  let best = null;
  for (const s of catalog) {
    if (s.latitude == null || s.longitude == null) continue;
    const distanceKm = haversineKm(lat, lon, s.latitude, s.longitude);
    if (!best || distanceKm < best.distanceKm) best = { station: s, distanceKm };
  }
  return best;
}

/**
 * Lê data/shelters.json — abrigos com procedência. Vazio enquanto não houver
 * fonte viva (ver README, seção "Abrigos").
 * @param {boolean} [force]
 * @returns {Promise<object|null>}
 */
async function fetchShelters(force = false) {
  if (sheltersCache && !force) return sheltersCache;
  sheltersCache = await fetchData('shelters.json');
  return sheltersCache;
}

/**
 * Lê data/elnino.json (anomalias de SST da NOAA).
 * @param {boolean} [force]
 * @returns {Promise<object|null>}
 */
async function fetchElnino(force = false) {
  if (elninoCache && !force) return elninoCache;
  elninoCache = await fetchData('elnino.json');
  return elninoCache;
}

/**
 * Lê data/history.json — histórico público de níveis coletado no servidor.
 * @param {boolean} [force]
 * @returns {Promise<object|null>}
 */
async function fetchHistory(force = false) {
  if (historyCache && !force) return historyCache;
  historyCache = await fetchData('history.json');
  return historyCache;
}

/** Invalida os caches de sessão (usado no refresh periódico). */
function invalidateCaches() {
  realtimeCache = null;
  elninoCache = null;
  historyCache = null;
  // Catálogo e abrigos não são invalidados: muda de mês em mês, não de 5 em 5 minutos.
}

// === Orquestrador ===

/**
 * Coleta tudo que estiver disponível. Sem dado real, os campos vêm vazios e
 * `diagnostics` explica o porquê de cada fonte — nada é preenchido com exemplo.
 * @returns {Promise<object>}
 */
async function fetchAll() {
  const [levelResult, inmetAlerts, dcrsAlerts, elnino, history, shelters] = await Promise.allSettled([
    fetchLevelGuaiba(),
    fetchINMETAlertas(),
    fetchDCRSAlertas(),
    fetchElnino(),
    fetchHistory(),
    fetchShelters(),
  ]);

  const level = levelResult.status === 'fulfilled'
    ? levelResult.value
    : { stations: [], source: null, collectedAt: null, ageMs: null, unavailable: true, reason: 'erro-coleta' };

  const inmet = inmetAlerts.status === 'fulfilled'
    ? inmetAlerts.value
    : { alerts: [], source: null, unavailable: true };
  const dcrs = dcrsAlerts.status === 'fulfilled'
    ? dcrsAlerts.value
    : { alerts: [], source: null, unavailable: true };

  const alerts = [...inmet.alerts, ...dcrs.alerts];

  const elninoData = elnino.status === 'fulfilled' ? elnino.value : null;
  const historyData = history.status === 'fulfilled' ? history.value : null;
  const sheltersData = shelters.status === 'fulfilled' ? shelters.value : null;

  return {
    level,
    alerts,
    elnino: elninoData,
    history: historyData,
    shelters: sheltersData,
    diagnostics: {
      level: level.unavailable ? (level.reason || 'indisponivel') : 'ok',
      inmet: inmet.unavailable ? 'indisponivel' : 'ok',
      dcrs: dcrs.unavailable ? 'indisponivel' : 'ok',
      elnino: elninoData ? 'ok' : 'indisponivel',
    },
    sources: {
      level: level.source,
      alerts: [inmet.source, dcrs.source].filter(Boolean).join(' + ') || null,
      elnino: elninoData ? (elninoData.source || 'NOAA CPC') : null,
    },
    lastFetch: new Date().toISOString(),
  };
}

/**
 * Indica se um alerta é simulado/offline (não oficial).
 * Mantido como portão de segurança: nada marcado assim pode virar notificação.
 * @param {object} a
 * @returns {boolean}
 */
function isSimulatedAlert(a) {
  const s = String(a?.source || '').toLowerCase();
  return s.includes('simulação') || s.includes('offline') || s.includes('fallback');
}

// === Exports ===
export {
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY,
  FETCH_TIMEOUT,
  MAX_ALERT_AGE_MS,
  fetchWithRetry,
  fetchLevelGuaiba,
  fetchINMETAlertas,
  fetchDCRSAlertas,
  fetchRealtime,
  fetchStations,
  fetchShelters,
  fetchData,
  nearestStation,
  fetchElnino,
  fetchHistory,
  invalidateCaches,
  fetchAll,
  isFresh,
  ageMs,
  toLevelReading,
  isSimulatedAlert,
};

// === Tipos (JSDoc) ===
/**
 * @typedef {Object} LevelReading
 * @property {string} id
 * @property {string} station
 * @property {string} location
 * @property {number} levelMeters
 * @property {'subindo'|'estavel'|'descendo'} trend
 * @property {number|null} [alarmStatus] — alarme oficial de inundação (0 = sem alarme)
 * @property {string} recordedAt
 * @property {string} source
 */

/**
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} type
 * @property {'info'|'atencao'|'perigo'|'emergencia'} severity
 * @property {string} title
 * @property {string} message
 * @property {string[]} regions
 * @property {string} issuedAt
 * @property {string} source
 * @property {string[]} [instructions]
 */
