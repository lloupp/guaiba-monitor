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
 * Não há endpoint JSON público (ver Fase 1) — retorna dados de exemplo marcados
 * como "simulação/offline" para o MVP. A estrutura está pronta para plugar
 * uma fonte real quando disponível.
 * @returns {Promise<{stations: LevelReading[], source: string}>}
 */
async function fetchLevelGuaiba() {
  // Tenta endpoints reais (todos retornam 404/null na Fase 1)
  const realSources = [
    () => fetchWithRetry('https://www.ufrgs.br/iph/telemetria/'),
    () => fetchWithRetry(ENDPOINTS.cprmSace),
  ];

  for (const attempt of realSources) {
    const data = await attempt();
    if (data) {
      // Se conseguirmos HTML, tenta parsear — mas SACE não expõe JSON programável
      if (typeof data === 'string' && data.includes('bguaiba')) {
        // Nível não extractable do HTML do SACE sem parsing visível
        console.info('[api] SACE HTML retornado, mas sem endpoint JSON de nível — usando fallback.');
        break;
      }
    }
  }

  // Sempre fallback para sample (marcado como simulação)
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
 * Busca alertas da Defesa Civil RS via proxy CORS (api.allorigins.win).
 * Sem proxy, o browser é bloqueado por CORS. Fallback para sample.
 * @returns {Promise<{alerts: Alert[], source: string}>}
 */
async function fetchDCRSAlertas() {
  const proxyUrl = ENDPOINTS.dcrsProxy + encodeURIComponent(ENDPOINTS.dcrsAlertas);
  const html = await fetchWithRetry(proxyUrl);

  if (!html || typeof html !== 'string') {
    console.warn('[api] DCRS alertas não disponíveis (proxy falhou) — fallback para sample.');
    // DCRS sem dados reais — mergeia com alertas INMET que já podem ter vindo
    return { alerts: sampleAlerts(), source: 'simulação/offline (fallback DCRS)' };
  }

  // Parse HTML simples para extrair texto de alertas
  const alerts = parseDCRSAlerts(html);
  if (alerts.length === 0) {
    // HTML carregado, mas sem alertas parseáveis
    return { alerts: [], source: 'Defesa Civil RS (scraping)' };
  }
  return { alerts, source: 'Defesa Civil RS (scraping via proxy)' };
}

/** Parser minimal de HTML da DCRS — extrai títulos e descrições de alertas */
function parseDCRSAlerts(html) {
  const alerts = [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Busca por elementos que contenham "alerta" ou "aviso"
    const items = doc.querySelectorAll('h3, h4, .alerta, .aviso, li');
    items.forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 10 && (text.toLowerCase().includes('alerta') || text.toLowerCase().includes('aviso'))) {
        const severity = text.toLowerCase().includes('perigo') ? 'perigo'
          : text.toLowerCase().includes('vermelho') || text.toLowerCase().includes('crític') ? 'critico'
          : text.toLowerCase().includes('laranja') || text.toLowerCase().includes('sever') ? 'severa'
          : 'atencao';
        alerts.push({
          id: `dcrs-${Date.now()}-${alerts.length}`,
          type: 'Defesa Civil',
          severity,
          title: text.substring(0, 80),
          message: text,
          regions: ['Rio Grande do Sul'],
          issuedAt: new Date().toISOString(),
          source: 'Defesa Civil RS',
        });
      }
    });
  } catch (err) {
    console.warn('[api] Erro ao parsear HTML da DCRS:', err.message);
  }
  return alerts;
}

// === Orquestrador ===

/**
 * Coleta todos os dados disponíveis, com fallback graceful.
 * Nível: sempre simulação (sem endpoint real).
 * Alertas: INMET (real) + DCRS (proxy) + sample (fallback).
 * @returns {Promise<{level: {stations, source}, alerts: Alert[], weather: WeatherForecast[], lastFetch: string}>}
 */
async function fetchAll() {
  const [levelResult, inmetAlerts, dcrsAlerts, weather] = await Promise.allSettled([
    fetchLevelGuaiba(),
    fetchINMETAlertas(),
    fetchDCRSAlertas(),
    fetchINMETPrevisao(),
  ]);

  const level = levelResult.status === 'fulfilled'
    ? levelResult.value
    : { stations: sampleLevels(), source: 'simulação/offline (erro coleta)' };

  const alerts = [
    ...(inmetAlerts.status === 'fulfilled' ? inmetAlerts.value.alerts : sampleAlerts()),
    ...(dcrsAlerts.status === 'fulfilled' ? dcrsAlerts.value.alerts : []),
  ];

  const weatherData = weather.status === 'fulfilled'
    ? weather.value.weather
    : sampleWeather();

  return {
    level,
    alerts,
    weather: weatherData,
    lastFetch: new Date().toISOString(),
  };
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
  fetchAll,
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
