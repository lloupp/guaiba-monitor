// collect.js — Coletor server-side (roda no GitHub Actions, sem CORS)
//
// Busca fontes reais que o navegador não consegue acessar diretamente e grava
// em JSONs dentro do repo, que o site estático lê de mesma origem:
//   data/realtime.json  → nível do Guaíba + alertas da Defesa Civil RS
//   data/elnino.json    → anomalias de SST das regiões Niño (El Niño/La Niña)
//
// Execução:
//   node scripts/collect.js
//
// Importável também como módulo (as funções de parse são puras e testáveis);
// a execução principal só roda quando este arquivo é o entry point.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { parseNinoText, deriveEnsoState } from '../js/elnino.js';

const DATA_DIR = new URL('../data/', import.meta.url);
const REALTIME_FILE = new URL('realtime.json', DATA_DIR);
const ELNINO_FILE = new URL('elnino.json', DATA_DIR);
const HISTORY_FILE = new URL('history.json', DATA_DIR);

const DCRS_RSS = 'https://www.defesacivil.rs.gov.br/rss';
const NOAA_NINO_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';

// GraphQL da Defesa Civil RS — Rede Hidrometeorológica
// Fonte pública (sem auth) que fornece nível de rio em tempo quase real.
const DCRS_GRAPHQL_URL = 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';
const DCRS_CLIENT = 'casa-militar-defesa-civil-rs';

// Estação do Lago Guaíba (Barra do Ribeiro) — melhor proxy do nível do Guaíba.
// Fallback: DCRS-00033 (Porto Alegre - Ipanema) se a principal falhar.
// Estasções adicionais para o seletor de múltiplas estações (Fase B.3):
const GUAIBA_STATIONS = [
  { code: 'DCRS-00054', name: 'Barra do Ribeiro - Lago Guaíba' },
  { code: 'DCRS-00033', name: 'Porto Alegre - Ipanema' },
];

const UA = 'GuaibaMonitor/1.0 (coleta automática)';

/** Busca texto com timeout. @returns {Promise<string>} */
async function fetchText(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extrai um valor de texto XML/RSS codificando entidades comuns.
 * @param {string} raw
 * @returns {string}
 */
function decodeXml(raw) {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parsea o RSS da Defesa Civil RS e extrai os avisos/alertas ativos.
 * @param {string} xml
 * @returns {object[]} Alert[]
 */
export function parseDcrsRss(xml) {
  if (!xml || !xml.includes('<item>')) return [];
  const alerts = [];
  const items = xml.split(/<item>/).slice(1);
  for (const it of items) {
    const close = it.indexOf('</item>');
    const block = close >= 0 ? it.slice(0, close) : it;
    const g = (re) => {
      const m = re.exec(block);
      return m ? m[1] : '';
    };
    const title = decodeXml(g(/<title>([\s\S]*?)<\/title>/));
    const description = decodeXml(g(/<description>([\s\S]*?)<\/description>/));
    const link = decodeXml(g(/<link>([\s\S]*?)<\/link>/));
    const pubDate = g(/<pubDate>([\s\S]*?)<\/pubDate>/) || g(/<dc:date>([\s\S]*?)<\/dc:date>/);
    if (!title) continue;

    // Severidade é baseada na CONDITION descrita no título (não no texto
    // padrão "Emergência ligue 190/193" que aparece em todas as mensagens).
    // Todos os títulos começam com "Defesa Civil alerta:", então a condição
    // real é "condição de ATENÇÃO/ALERTA/SEVERO". Maxima prioridade aos casos
    // mais graves, depois ATENÇÃO, depois ALERTA.
    const cond = title.toLowerCase();
    let severity = 'atencao';
    if (/cell broadcast|máximo|sever/i.test(cond)) severity = 'emergencia';
    else if (/atenção|atencao/i.test(cond)) severity = 'atencao';
    else if (/alerta|perigo/i.test(cond)) severity = 'perigo';

    const text = title.length > 30 ? title : title + (description ? ' — ' + description : '');
    alerts.push({
      id: `dcrs-${Math.abs(hash(title)).toString(36)}`,
      type: 'Defesa Civil',
      severity,
      title,
      message: description || text,
      regions: extractRegions(title + ' ' + description),
      issuedAt: pubDate || new Date().toISOString(),
      link,
      source: 'Defesa Civil RS',
    });
  }
  return alerts;
}

/** Hash simples (djb2) para gerar ID estável do alerta. */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Regiões mencionadas no alerta (heurística simples). */
function extractRegions(text) {
  const known = ['Porto Alegre', 'Canoas', 'Guaíba', 'Região Metropolitana', 'Litoral', 'Serra', 'Vale'];
  const found = known.filter(r => (text || '').toLowerCase().includes(r.toLowerCase()));
  return found.length ? found : ['Rio Grande do Sul'];
}

/**
 * Consulta o GraphQL da Defesa Civil RS (tags_data) e extrai o nível atual
 * do Guaíba. Tenta estações em ordem (Lago Guaíba → Ipanema como fallback).
 * @returns {Promise<object|null>} { levelMeters, trend, stationCode, stationName, timestamp, source }
 */
export async function collectLevel() {
  const query = `{
    tags_data(clients: ["${DCRS_CLIENT}"]) {
      qualle_meteorologia {
        codigo timestamp
        name { prefix general local }
        data { rio { rio_nivel { value } rio_nivel_tendencia { value } } }
      }
    }
  }`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(DCRS_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
    if (!json.data?.tags_data?.qualle_meteorologia) return null;

    const stations = json.data.tags_data.qualle_meteorologia;
    const byCode = {};
    for (const s of stations) byCode[s.codigo] = s;

    // Coleta TODAS as estações candidatas com nível válido
    const allStations = [];
    let primaryLevel = null;

    for (const target of GUAIBA_STATIONS) {
      const s = byCode[target.code];
      if (!s) continue;
      const rio = s.data?.rio;
      const nivel = rio?.rio_nivel?.value;
      if (nivel == null || Number.isNaN(nivel)) continue;

      // HEURÍSTICA: Validamos entre 0 e 30m — valores plausíveis para o Guaíba.
      if (nivel < 0 || nivel > 30) {
        console.warn(`[collect] ${target.code} nível fora do range plausível: ${nivel} — pulando`);
        continue;
      }

      const trend = rio?.rio_nivel_tendencia?.value ?? null;
      const nameParts = s.name || {};
      const stationName = [nameParts.general, nameParts.local]
        .filter(Boolean).join(' ').trim() || target.name;

      const stationData = {
        levelMeters: Math.round(nivel * 100) / 100,
        trend: trend != null ? Math.round(trend * 10000) / 10000 : null,
        stationCode: s.codigo,
        stationName,
        timestamp: s.timestamp || new Date().toISOString(),
        source: 'Defesa Civil RS (Rede Hidrometeorológica)',
      };

      allStations.push(stationData);

      // A primeira estação válida é a "principal" (mantém compatibilidade)
      if (!primaryLevel) {
        primaryLevel = stationData;
      }
    }

    if (allStations.length === 0) {
      console.warn('[collect] Nenhuma estação do Guaíba retornou nível válido');
      return null;
    }

    // Retorna a principal + todas as estações válidas para o seletor
    return { ...primaryLevel, allStations };
  } catch (err) {
    console.warn('[collect] nível indisponível:', err.message);
    return null;
  }
}

/** Coleta El Niño da NOAA CPC. @returns {Promise<object|null>} */
export async function collectElNino() {
  try {
    const text = await fetchText(NOAA_NINO_URL);
    const parsed = parseNinoText(text);
    if (!parsed) return null;
    const ssta = parsed.regions.nino34 && parsed.regions.nino34.ssta;
    return {
      collectedAt: new Date().toISOString(),
      week: parsed.week,
      regions: parsed.regions,
      state: deriveEnsoState(ssta),
      source: 'NOAA CPC',
    };
  } catch (err) {
    console.warn('[collect] El Niño indisponível:', err.message);
    return null;
  }
}

/** Coleta alertas da Defesa Civil RS via RSS. @returns {Promise<object[]>} */
export async function collectDcrsAlerts() {
  try {
    const xml = await fetchText(DCRS_RSS);
    return parseDcrsRss(xml);
  } catch (err) {
    console.warn('[collect] DCRS indisponível:', err.message);
    return [];
  }
}

/** Grava um JSON no disco. */
async function writeJson(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

/**
 * Atualiza o histórico público de níveis (data/history.json).
 * Adiciona a leitura atual, deduplica por timestamp, e mantém apenas
 * as últimas 24h. Este arquivo é versionado no git pelo Actions,
 * dando a todos os visitantes um histórico real da tendência do nível.
 * @param {object} level — leitura de nível de collectLevel()
 * @param {string} collectedAt — ISO timestamp da coleta atual
 * @returns {Promise<object>} histórico atualizado
 */
export async function updateHistory(level, collectedAt) {
  // Lê o histórico atual (se existir)
  let history = { collectedAt, readings: [] };
  try {
    const raw = await readFile(HISTORY_FILE, 'utf-8');
    history = JSON.parse(raw);
    if (!Array.isArray(history.readings)) history.readings = [];
  } catch {
    // Arquivo não existe ainda — começa do zero
  }

  if (!level || level.levelMeters == null) {
    // Sem nível válido — só atualiza collectedAt e grava
    history.collectedAt = collectedAt;
    await writeJson(HISTORY_FILE, history);
    return history;
  }

  const entry = {
    timestamp: level.timestamp || collectedAt,
    levelMeters: level.levelMeters,
    trend: level.trend,
    stationCode: level.stationCode,
    stationName: level.stationName,
    source: level.source,
  };

  // Deduplica por timestamp (se já existe leitura com mesmo timestamp, substitui)
  const existingIdx = history.readings.findIndex(
    r => r.timestamp === entry.timestamp
  );
  if (existingIdx >= 0) {
    history.readings[existingIdx] = entry;
  } else {
    history.readings.push(entry);
  }

  // Ordena cronologicamente
  history.readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Cap em 24h (descarta leituras mais antigas)
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  history.readings = history.readings.filter(
    r => new Date(r.timestamp).getTime() >= twentyFourHoursAgo
  );

  history.collectedAt = collectedAt;
  await writeJson(HISTORY_FILE, history);
  return history;
}

/** Executa a coleta completa e grava os JSONs. */
async function main() {
  const [level, elnino, dcrsAlerts] = await Promise.all([
    collectLevel(),
    collectElNino(),
    collectDcrsAlerts(),
  ]);

  await writeJson(REALTIME_FILE, {
    collectedAt: new Date().toISOString(),
    level,
    dcrsAlerts,
    sources: ['Defesa Civil RS (RSS)', ...(level ? ['Defesa Civil RS (GraphQL — Rede Hidrometeorológica)'] : [])],
  });

  // Atualiza histórico público (data/history.json) com a leitura atual
  const historyResult = await updateHistory(level, new Date().toISOString());

  if (elnino) await writeJson(ELNINO_FILE, elnino);

  console.log(JSON.stringify({
    ok: true,
    level: level ? `${level.levelMeters} m` : 'null (simulação marcada)',
    elnino: elnino ? `${elnino.state} (Nino3.4 ${elnino.regions.nino34.ssta.toFixed(2)}°C)` : 'null',
    dcrsAlerts: dcrsAlerts.length,
    historyReadings: historyResult.readings.length,
  }, null, 2));
}

// Só executa quando este arquivo é o entry point (não ao importar p/ testes).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[collect] falha na coleta:', err);
    process.exit(1);
  });
}

export { writeJson };
