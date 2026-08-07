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

import { writeFile, mkdir } from 'node:fs/promises';
import { parseNinoText, deriveEnsoState } from '../js/elnino.js';

const DATA_DIR = new URL('../data/', import.meta.url);
const REALTIME_FILE = new URL('realtime.json', DATA_DIR);
const ELNINO_FILE = new URL('elnino.json', DATA_DIR);

const DCRS_RSS = 'https://www.defesacivil.rs.gov.br/rss';
const NOAA_NINO_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';
// Nível do Guaíba: sem endpoint JSON público estável (o SACE é DWR com sessão).
// Manter null até existir fonte confiável — o site mostra simulação marcada.
const LEVEL_URL = null; // ex.: 'https://...' quando existir

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
 * Tenta obter o nível atual do Guaíba (fontes confiáveis ainda não disponíveis).
 * @returns {Promise<object|null>}
 */
export async function collectLevel() {
  if (!LEVEL_URL) return null;
  try {
    const html = await fetchText(LEVEL_URL);
    // TODO: parse da cota quando uma fonte estável for identificada.
    void html;
    return null;
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

/** Executa a coleta completa e grava os JSONs. */
async function main() {
  const [level, elnino, dcrsAlerts] = await Promise.all([
    collectLevel(),
    collectElNino(),
    collectDcrsAlerts(),
  ]);

  await writeJson(REALTIME_FILE, {
    collectedAt: new Date().toISOString(),
    level, // null até haver fonte confiável
    dcrsAlerts,
    sources: ['Defesa Civil RS (RSS)'] + (level ? ['SACE/SGB'] : []),
  });

  if (elnino) await writeJson(ELNINO_FILE, elnino);

  console.log(JSON.stringify({
    ok: true,
    level: level ? `${level.levelMeters} m` : 'null (simulação marcada)',
    elnino: elnino ? `${elnino.state} (Nino3.4 ${elnino.regions.nino34.ssta.toFixed(2)}°C)` : 'null',
    dcrsAlerts: dcrsAlerts.length,
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
