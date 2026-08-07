// api.js — Coleta de dados (IPH/CPRM/INMET/Defesa Civil)
// Fase 3: Coleta de dados (API)
//
import { generateId } from './utils.js';
// Endpoints validados (ver docs/fase1-fontes-e-endpoints.md):
//   ✓ INMET  /avisos/ativos        — JSON, CORS aberto, sem auth
//   ✓ INMET  /previsao/{geocode}   — JSON, CORS aberto, sem auth (ex: 4314902=POA)
//   ✓ CPRM   /sace/                — HTML (visualização), SEM API JSON
//   ✗ DCRS   /avisos-e-alertas     — HTML, SEM CORS no browser (precisa de proxy)
//   ✗ IPH-UFRGS /telemetria/       — 404 (página removida)
//
// IMPORTANTE: Nível do Guaíba não tem endpoint JSON público sem CORS/token.
// Solução para MVP: dados de exemplo marcados como "simulação/offline".

// === Configuração ===
const ENDPOINTS = {
  inmetAlertas: 'https://apiprevmet3.inmet.gov.br/avisos/ativos',
  inmetPrevisao: (geocode) => `https://apiprevmet3.inmet.gov.br/previsao/${geocode}`,
  cprmSace: 'https://www.cprm.gov.br/sace/',
  dcrsAvisos: 'https://www.defesacivil.rs.gov.br/avisos-e-boletins',
  dcrsAlertas: 'https://www.defesacivil.rs.gov.br/avisos-e-alertas',
  dcrsProxy: 'https://api.allorigins.win/raw?url=',
};

// Geocodes IBGE
const GEOCODES = {
  portoAlegre: '4314902',
  canoas: '4304606',
  guaiba: '4304308',
};

// Estados monitorados (para filtrar alertas INMET)
const ESTADOS_MONITORADOS = ['Rio Grande do Sul'];

// === Política de retry e timeout ===
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 800; // ms (exponencial: 800, 1600, 3200)
const FETCH_TIMEOUT = 12000;  // 12 segundos

/**
 * Fetch com retry exponencial e timeout via AbortController.
 * Nunca joga — retorna null em caso de falha após todas as tentativas.
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<any|null>} parsed JSON ou texto
 */
async function fetchWithRetry(url, options = {}) {
  const opts = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Guaiba Monitor)' },
    ...options,
  };

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const signalOpts = { ...opts, signal: controller.signal };

    try {
      const response = await fetch(url, signalOpts);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers?.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } catch (err) {
      clearTimeout(timeoutId);
      // Última tentativa: loga e retorna null
      if (attempt === RETRY_ATTEMPTS) {
        console.warn(`[api] Falha após ${RETRY_ATTEMPTS} tentativas: ${url}`, err.message);
        return null;
      }
      // Backoff exponencial
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

// === Dados de exemplo (SIMULAÇÃO/OFFLINE) ===
// Marcados explicitamente como "simulação/offline" — nunca apresentados como reais.

/** @returns {LevelReading} */
function sampleLevelReading(station, location, levelMeters, trend) {
  return {
    id: `sample-${station}-${Date.now()}`,
    station,
    location,
    levelMeters: parseFloat(levelMeters.toFixed(2)),
    trend,
    recordedAt: new Date().toISOString(),
    source: 'simulação/offline',
  };
}

/** @returns {LevelReading[]} — sempre 3 estações para POA, Canoas, Guaíba */
function sampleLevels() {
  return [
    sampleLevelReading('poa-cais-maua', 'Porto Alegre', 2.13, 'subindo'),
    sampleLevelReading('canoas', 'Canoas', 1.82, 'estavel'),
    sampleLevelReading('guaiba-cidade', 'Guaíba', 1.45, 'descendo'),
  ];
}

/** @returns {Alert[]} */
function sampleAlerts() {
  return [
    {
      id: 'sample-alert-1',
      type: 'Vendaval',
      severity: 'perigo',
      title: 'Vendaval forte no RS',
      message: 'Rajadas de vento entre 40-60 km/h. Risco de queda de galhos. Evite sair em áreas expostas.',
      regions: ['Porto Alegre', 'Canoas', 'Guaíba'],
      issuedAt: new Date().toISOString(),
      source: 'simulação/offline',
    },
    {
      id: 'sample-alert-2',
      type: 'Chuva',
      severity: 'atencao',
      title: 'Chuva forte — atenção ao nível do Guaíba',
      message: 'Sistema frontal pode elevar o nível do rio nas próximas 24h. Monitore a barra.',
      regions: ['Porto Alegre'],
      issuedAt: new Date().toISOString(),
      source: 'simulação/offline',
    },
  ];
}

/** @returns {WeatherForecast[]} */
function sampleWeather() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    {
      geocode: GEOCODES.portoAlegre,
      location: 'Porto Alegre',
      date: today.toISOString().split('T')[0],
      summary: 'Muitas nuvens com nevoeiro',
      tempMax: 22,
      tempMin: 18,
      source: 'simulação/offline',
    },
    {
      geocode: GEOCODES.portoAlegre,
      location: 'Porto Alegre',
      date: tomorrow.toISOString().split('T')[0],
      summary: 'Parcialmente nublado',
      tempMax: 24,
      tempMin: 19,
      source: 'simulação/offline',
    },
  ];
}

// === Coletas ===

/**
 * Busca nível do Guaíba.
 * Fonte preferida: data/realtime.json (coletado pelo GitHub Actions, nível
 * real). Sem dado real, retorna dados de exemplo marcados como
 * "simulação/offline" — nunca apresentados como reais.
 * @returns {Promise<{stations: LevelReading[], source: string}>}
 */
async function fetchLevelGuaiba() {
  const rt = await fetchRealtime();
  if (rt && rt.level && rt.level.levelMeters != null && isFresh(rt.collectedAt)) {
    const l = rt.level;
    // Converte trend numérico (taxa de variação m/intervalo) para rótulo legível
    let trendLabel = 'estavel';
    if (typeof l.trend === 'number') {
      if (l.trend > 0.005) trendLabel = 'subindo';
      else if (l.trend < -0.005) trendLabel = 'descendo';
    } else if (typeof l.trend === 'string') {
      trendLabel = l.trend;
    }
    return {
      stations: [{
        id: l.stationCode || 'guaiba-lago',
        station: l.stationCode || 'guaiba-lago',
        location: l.stationName || 'Lago Guaíba',
        levelMeters: parseFloat(l.levelMeters),
        trend: trendLabel,
        trendValue: typeof l.trend === 'number' ? l.trend : null,
        recordedAt: l.timestamp || rt.collectedAt,
        source: l.source || 'Defesa Civil RS',
      }],
      source: l.source || 'Defesa Civil RS',
    };
  }

  // Fallback para sample (marcado como simulação)
  const levels = sampleLevels();
  return { stations: levels, source: 'simulação/offline' };
}

/**
 * Busca alertas meteorológicos INMET (CORS aberto — fetch direto no browser).
 * Filtra apenas pelo Rio Grande do Sul.
 * @returns {Promise<{alerts: Alert[], source: string}>}
 */
async function fetchINMETAlertas() {
  const data = await fetchWithRetry(ENDPOINTS.inmetAlertas);
  if (!data || !Array.isArray(data.hoje)) {
    console.warn('[api] INMET avisos não disponíveis — fallback para sample.');
    return { alerts: sampleAlerts(), source: 'simulação/offline (fallback INMET)' };
  }

  const alerts = data.hoje
    .filter(aviso => {
      const estados = (aviso.estados || '').toLowerCase();
      return ESTADOS_MONITORADOS.some(e => estados.includes(e.toLowerCase()));
    })
    .map(aviso => ({
      id: `inmet-${aviso.id || aviso.id_aviso || generateId()}`,
      type: aviso.descricao || 'Alerta',
      severity: mapINMETSeverity(aviso.severidade),
      title: aviso.descricao || 'Aviso Meteorológico',
      message: Array.isArray(aviso.riscos) ? aviso.riscos.join(' ') : (aviso.riscos || ''),
      regions: mapINMETMunicipios(aviso.geocodes),
      issuedAt: aviso.data_inicio || new Date().toISOString(),
      source: 'INMET',
      instructions: Array.isArray(aviso.instrucoes) ? aviso.instrucoes : [],
    }));

  if (alerts.length === 0) {
    // Nenhum alerta ativo para RS — isso é válido, não é fallback
    return { alerts: [], source: 'INMET' };
  }

  return { alerts, source: 'INMET' };
}

/** Mapeia severidade INMET para categorias do esquema */
function mapINMETSeverity(severidade) {
  if (!severidade) return 'info';
  const s = severidade.toLowerCase();
  if (s.includes('perigo potencial') || s.includes('perigo')) return 'perigo';
  if (s.includes('atenção') || s.includes('alerta')) return 'atencao';
  if (s.includes('emergência') || s.includes('urgência')) return 'emergencia';
  return 'info';
}

/** Mapeia geocodes INMET para nomes de regiões locais */
function mapINMETMunicipios(geocodes) {
  if (!geocodes) return [];
  const codes = geocodes.split(',').map(c => c.trim());
  const regions = [];
  if (codes.includes(GEOCODES.portoAlegre)) regions.push('Porto Alegre');
  if (codes.includes(GEOCODES.canoas)) regions.push('Canoas');
  if (codes.includes(GEOCODES.guaiba)) regions.push('Guaíba');
  return regions.length ? regions : ['Região Metropolitana'];
}

/**
 * Busca previsão do tempo INMET para POA.
 * @returns {Promise<{weather: WeatherForecast[], source: string}>}
 */
async function fetchINMETPrevisao(geocode = GEOCODES.portoAlegre) {
  const data = await fetchWithRetry(ENDPOINTS.inmetPrevisao(geocode));
  if (!data || !data[geocode]) {
    console.warn(`[api] INMET previsão para ${geocode} não disponível — fallback.`);
    return { weather: sampleWeather(), source: 'simulação/offline (fallback INMET)' };
  }

  const locationData = data[geocode];
  const weather = Object.entries(locationData).map(([dateStr, periods]) => {
    const manha = periods.manha || {};
    return {
      geocode,
      location: manha.entidade || 'Porto Alegre',
      date: dateStr,
      summary: manha.resumo || 'Sem previsão',
      tempMax: manha.temp_max,
      tempMin: manha.temp_min,
      source: 'INMET',
    };
  });

  return { weather, source: 'INMET' };
}

/**
 * Busca alertas reais da Defesa Civil RS a partir de data/realtime.json
 * (coletado pelo GitHub Actions via RSS). NUNCA mistura alertas de exemplo
 * nesta lista: sem dados reais, retorna lista vazia (estado válido).
 * @returns {Promise<{alerts: Alert[], source: string}>}
 */
async function fetchDCRSAlertas() {
  const rt = await fetchRealtime();
  const alerts = (rt && Array.isArray(rt.dcrsAlerts) && isFresh(rt.collectedAt))
    ? rt.dcrsAlerts
    : [];
  if (alerts.length === 0) {
    return { alerts: [], source: 'Defesa Civil RS (sem dados no momento)' };
  }
  return { alerts, source: 'Defesa Civil RS (RSS)' };
}

// === Dados coletados pelo GitHub Actions (data/realtime.json, data/elnino.json) ===

// Idade máxima dos dados coletados (server) antes de serem considerados obsoletos
const MAX_COLLECTED_AGE_MS = 6 * 60 * 60 * 1000; // 6 horas

let realtimeCache = null;
let elninoCache = null;

/** Verifica se um timestamp ISO é recente. @param {string} iso @returns {boolean} */
function isFresh(iso) {
  if (!iso) return false;
  const age = Date.now() - new Date(iso).getTime();
  return !Number.isNaN(age) && age >= 0 && age < MAX_COLLECTED_AGE_MS;
}

/**
 * Lê data/realtime.json (nível + alertas DCRS coletados no servidor).
 * Mesma origem → sem CORS. Faz cache por sessão.
 * @returns {Promise<object|null>}
 */
async function fetchRealtime(force = false) {
  if (realtimeCache && !force) return realtimeCache;
  realtimeCache = await fetchWithRetry('data/realtime.json');
  return realtimeCache;
}

/**
 * Lê data/elnino.json (anomalias de SST NOOA coletadas no servidor).
 * @returns {Promise<object|null>}
 */
async function fetchElnino(force = false) {
  if (elninoCache && !force) return elninoCache;
  elninoCache = await fetchWithRetry('data/elnino.json');
  return elninoCache;
}

// === Orquestrador ===

/**
 * Coleta todos os dados disponíveis, com fallback graceful.
 * Alertas reais: INMET (client) + Defesa Civil RS (realtime.json).
 * Alertas simulados (sample) só aparecem quando não há dado real algum.
 * @returns {Promise<{level, alerts, weather, elnino, lastFetch}>}
 */
async function fetchAll() {
  const [levelResult, inmetAlerts, dcrsAlerts, weather, elnino] = await Promise.allSettled([
    fetchLevelGuaiba(),
    fetchINMETAlertas(),
    fetchDCRSAlertas(),
    fetchINMETPrevisao(),
    fetchElnino(),
  ]);

  const level = levelResult.status === 'fulfilled'
    ? levelResult.value
    : { stations: sampleLevels(), source: 'simulação/offline (erro coleta)' };

  const inmetReal = inmetAlerts.status === 'fulfilled'
    ? inmetAlerts.value.alerts.filter(a => !isSimulatedAlert(a))
    : [];
  const dcrsReal = dcrsAlerts.status === 'fulfilled' ? dcrsAlerts.value.alerts : [];

  // Só usa simulados (sample) quando NENHUMA fonte real de alerta respondeu.
  const alerts = (inmetReal.length + dcrsReal.length) > 0
    ? [...inmetReal, ...dcrsReal]
    : sampleAlerts();

  const weatherData = weather.status === 'fulfilled'
    ? weather.value.weather
    : sampleWeather();

  return {
    level,
    alerts,
    weather: weatherData,
    elnino: elnino.status === 'fulfilled' ? elnino.value : null,
    lastFetch: new Date().toISOString(),
  };
}

/** Indica se um alerta é simulado/offline (não oficial). @param {object} a */
function isSimulatedAlert(a) {
  const s = String(a?.source || '').toLowerCase();
  return s.includes('simulação') || s.includes('offline') || s.includes('fallback');
}

// === Exports ===
export {
  ENDPOINTS,
  GEOCODES,
  ESTADOS_MONITORADOS,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY,
  FETCH_TIMEOUT,
  fetchWithRetry,
  fetchLevelGuaiba,
  fetchINMETAlertas,
  fetchINMETPrevisao,
  fetchDCRSAlertas,
  fetchRealtime,
  fetchElnino,
  fetchAll,
  isFresh,
  sampleLevels,
  sampleAlerts,
  sampleWeather,
  mapINMETSeverity,
  mapINMETMunicipios,
};
export default {
  fetchWithRetry,
  fetchLevelGuaiba,
  fetchINMETAlertas,
  fetchINMETPrevisao,
  fetchDCRSAlertas,
  fetchAll,
};

// === Tipos (JSDoc) ===
/**
 * @typedef {Object} LevelReading
 * @property {string} id
 * @property {string} station
 * @property {string} location
 * @property {number} levelMeters
 * @property {'subindo'|'estavel'|'descendo'} trend
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

/**
 * @typedef {Object} WeatherForecast
 * @property {string} geocode
 * @property {string} location
 * @property {string} date
 * @property {string} summary
 * @property {number} tempMax
 * @property {number} tempMin
 * @property {string} source
 */
