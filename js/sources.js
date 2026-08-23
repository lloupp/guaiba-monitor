// sources.js — Coleta das fontes externas (só fetch, sem I/O de disco).
//
// Este módulo roda nos dois lugares que consomem as fontes:
//   - scripts/collect.js  (GitHub Actions → grava JSONs no repo)
//   - worker/            (Cloudflare Worker → cron, KV e Web Push)
//
// Por isso não importa nada de `node:` — o Worker não tem sistema de arquivos.

import { parseNinoText, deriveEnsoState } from './elnino.js';
import { placesFromStationName, normalizePlace, haversineKm } from './utils.js';

const DCRS_RSS = 'https://www.defesacivil.rs.gov.br/rss';
const NOAA_NINO_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';

// INMET: os avisos de todo o Brasil vêm num JSON de ~540 KB sem compressão.
// Buscar isso no celular a cada abertura, para exibir alguns avisos do RS, é
// caro para quem está numa emergência — a coleta acontece aqui, no servidor.
//
// A previsão do tempo por município foi removida: era coletada, trafegada e
// nunca exibida. Para risco de alagamento, a chuva JÁ MEDIDA pela estação
// (rain24h/rain72h) é sinal melhor que previsão.
const INMET_AVISOS = 'https://apiprevmet3.inmet.gov.br/avisos/ativos';

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

// Janela do histórico versionado e teto de estações acompanhadas nele.
export const HISTORY_WINDOW_HOURS = 72;
const MAX_TRACKED_STATIONS = 15;

// Janela do histórico versionado e teto de estações acompanhadas nele.

/** Extrai o número de um campo {value} do GraphQL. @returns {number|null} */
function pick(field) {
  const v = field && field.value;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

/** Arredonda para N casas (os floats crus da API têm 15 dígitos inúteis). */
function round(v, casas = 1) {
  if (v == null) return null;
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

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
export function parseDcrsRss(xml, municipios = []) {
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
      regions: extractRegions(`${title} ${description}`, municipios),
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

/**
 * Municípios citados no alerta.
 *
 * Casa o texto contra os municípios que a rede monitora (derivados dos nomes
 * das estações). A heurística anterior procurava palavras como "Serra", "Vale"
 * e "Litoral", que aparecem em qualquer boletim e marcavam alertas do estado
 * inteiro como se fossem de uma região específica.
 *
 * @param {string} text
 * @param {string[]} municipios — lista de municípios conhecidos
 * @returns {string[]} municípios citados, ou ['Rio Grande do Sul'] se nenhum
 */
export function extractRegions(text, municipios = []) {
  // Tira o nome do estado antes de procurar municípios: "Rio Grande do Sul"
  // contém "Rio Grande", que é município e casaria em todo boletim estadual.
  const alvo = normalizePlace(text || '').replace(/rio grande do sul/g, ' estado ');
  if (!alvo.trim()) return ['Rio Grande do Sul'];

  const found = [];
  for (const m of municipios) {
    const termo = normalizePlace(m);
    if (termo.length < 4) continue;
    // Fronteira de palavra: evita casar "Ipê" dentro de "Ipiranga".
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(termo)}([^a-z0-9]|$)`);
    if (re.test(alvo) && !found.includes(m)) found.push(m);
  }

  return found.length > 0 ? found : ['Rio Grande do Sul'];
}

/** Escapa metacaracteres de regex em nomes de município. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Municípios derivados dos nomes das estações.
 * "Santo Antônio das Missões/São Borja" → ["Santo Antônio das Missões", "São Borja"]
 * @param {object[]} stations
 * @returns {string[]}
 */
export function municipiosFromStations(stations) {
  const set = new Set();
  for (const s of stations || []) {
    placesFromStationName(s.stationName).forEach((m) => set.add(m));
  }
  return [...set];
}

/**
 * Consulta o GraphQL da Defesa Civil RS (tags_data) e coleta TODAS as estações
 * fluviométricas do estado — não só as do Guaíba.
 *
 * Além do nível, traz o alarme oficial de inundação, a chuva acumulada e a
 * posição (bacia/lat/lon/altitude). O alarme importa porque as réguas da DCRS
 * não têm cota numérica publicada: sem ele, não haveria como classificar a
 * situação sem emprestar a cota de outra régua — o que seria errado.
 *
 * ATENÇÃO: os níveis NÃO são comparáveis entre estações. Algumas medem régua
 * local (1,54 m) e outras cota absoluta (859,92 m). Por isso não há filtro de
 * faixa "plausível" global aqui — cada estação é avaliada contra si mesma.
 *
 * @returns {Promise<{primary: object, stations: object[]}|null>}
 */
export async function collectLevel() {
  const query = `{
    tags_data(clients: ["${DCRS_CLIENT}"]) {
      qualle_meteorologia {
        codigo timestamp
        name { prefix general local }
        position { bacia latitude longitude altitude }
        data {
          rio {
            rio_nivel { value }
            rio_nivel_tendencia { value }
            rio_alarmes { inundacao { status { value } ativo { value } } }
          }
          chuva {
            acumulado { h001 { value } h024 { value } h072 { value } }
            deslizamento { h024 { status { value } } }
          }
        }
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

    const stations = json.data.tags_data.qualle_meteorologia
      .map(toStationReading)
      .filter(Boolean);

    if (stations.length === 0) {
      console.warn('[collect] nenhuma estação retornou nível válido');
      return null;
    }

    // Estação principal: a primeira da lista de preferência que respondeu.
    const byCode = new Map(stations.map((s) => [s.stationCode, s]));
    const primary = GUAIBA_STATIONS.map((g) => byCode.get(g.code)).find(Boolean) || stations[0];

    return { primary, stations };
  } catch (err) {
    console.warn('[collect] nível indisponível:', err.message);
    return null;
  }
}

/**
 * Converte uma estação do GraphQL para o formato do projeto.
 * @param {object} s
 * @returns {object|null} null quando a estação não tem nível
 */
export function toStationReading(s) {
  const rio = s.data?.rio;
  const nivel = pick(rio?.rio_nivel);
  if (nivel == null) return null;

  const nameParts = s.name || {};
  const stationName = [nameParts.general, nameParts.local]
    .filter(Boolean).join(' ').trim() || s.codigo;
  const pos = s.position || {};
  const trend = pick(rio?.rio_nivel_tendencia);

  return {
    stationCode: s.codigo,
    stationName,
    levelMeters: Math.round(nivel * 100) / 100,
    trend: trend != null ? Math.round(trend * 10000) / 10000 : null,
    // Alarme oficial de inundação (0 = sem alarme).
    alarmStatus: pick(rio?.rio_alarmes?.inundacao?.status),
    rain1h: round(pick(s.data?.chuva?.acumulado?.h001)),
    rain24h: round(pick(s.data?.chuva?.acumulado?.h024)),
    rain72h: round(pick(s.data?.chuva?.acumulado?.h072)),
    landslideStatus: pick(s.data?.chuva?.deslizamento?.h024?.status),
    basin: pos.bacia || null,
    latitude: pos.latitude ?? null,
    longitude: pos.longitude ?? null,
    altitude: pos.altitude ?? null,
    timestamp: s.timestamp || new Date().toISOString(),
    source: 'Defesa Civil RS (Rede Hidrometeorológica)',
  };
}

/**
 * Leitura enxuta para o realtime.json — só o que muda a cada coleta.
 * @param {object} s
 * @returns {object}
 */
export function toRealtimeReading(s) {
  // Campos nulos são omitidos e a fonte vai uma vez só no topo do arquivo:
  // 130 estações × campos repetidos pesam no plano de dados de quem mais precisa.
  const out = {
    stationCode: s.stationCode,
    stationName: s.stationName,
    levelMeters: s.levelMeters,
    timestamp: s.timestamp,
  };
  if (s.trend != null) out.trend = s.trend;
  if (s.alarmStatus != null) out.alarmStatus = s.alarmStatus;
  if (s.rain1h != null) out.rain1h = s.rain1h;
  if (s.rain24h != null) out.rain24h = s.rain24h;
  if (s.rain72h != null) out.rain72h = s.rain72h;
  if (s.landslideStatus != null) out.landslideStatus = s.landslideStatus;
  return out;
}

/**
 * Catálogo das estações (o que não muda a cada coleta): código, nome, bacia,
 * coordenadas. Fica em data/stations.json para o app achar a estação mais
 * próxima de quem abre o app sem baixar as leituras de todas elas.
 * @param {object[]} stations
 * @returns {object[]}
 */
export function buildStationCatalog(stations) {
  const comBacia = stations.filter((s) => s.basin && s.latitude != null);

  return stations
    .map((s) => {
      const inferida = s.basin ? null : inferBasin(s, comBacia);
      return {
        code: s.stationCode,
        name: s.stationName,
        basin: s.basin || (inferida ? inferida.basin : null),
        // Marca a bacia deduzida para a interface não apresentá-la como oficial.
        basinInferred: inferida ? true : undefined,
        latitude: round(s.latitude, 5),
        longitude: round(s.longitude, 5),
        altitude: round(s.altitude, 1),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

// Raio máximo para deduzir a bacia de uma estação pela vizinha conhecida.
// Acima disso é chute: a estação fica sem bacia, e o app a agrupa em "outras".
const BASIN_INFER_RADIUS_KM = 30;

/**
 * Deduz a bacia de uma estação sem essa informação (40 das 130 vêm sem) a
 * partir da estação com bacia conhecida mais próxima.
 * @param {object} station
 * @param {object[]} comBacia
 * @returns {{basin: string, distanceKm: number}|null}
 */
function inferBasin(station, comBacia) {
  if (station.latitude == null || station.longitude == null) return null;
  let best = null;
  for (const outra of comBacia) {
    const d = haversineKm(station.latitude, station.longitude, outra.latitude, outra.longitude);
    if (!best || d < best.distanceKm) best = { basin: outra.basin, distanceKm: d };
  }
  return best && best.distanceKm <= BASIN_INFER_RADIUS_KM ? best : null;
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

/**
 * Coleta alertas da Defesa Civil RS via RSS.
 * @param {string[]} [municipios] — para localizar os alertas
 * @returns {Promise<object[]>}
 */
export async function collectDcrsAlerts(municipios = []) {
  try {
    const xml = await fetchText(DCRS_RSS);
    return parseDcrsRss(xml, municipios);
  } catch (err) {
    console.warn('[collect] DCRS indisponível:', err.message);
    return [];
  }
}

/**
 * Estações cujo histórico entra no arquivo versionado: as do Lago Guaíba, as
 * de referência do projeto e as que estiverem em alarme oficial.
 * @param {object[]} stations
 * @returns {object[]}
 */
export function selectTrackedStations(stations) {
  const preferred = new Set(GUAIBA_STATIONS.map((g) => g.code));
  const tracked = stations.filter((s) =>
    preferred.has(s.stationCode) ||
    (s.basin || '').includes('Lago Guaíba') ||
    (s.alarmStatus != null && Number(s.alarmStatus) > 0)
  );
  return tracked.slice(0, MAX_TRACKED_STATIONS);
}

// === INMET (coletado no servidor) ===

/** Severidade do INMET → categorias do projeto. */
export function mapINMETSeverity(severidade) {
  if (!severidade) return 'info';
  const s = String(severidade).toLowerCase();
  if (s.includes('perigo potencial') || s.includes('perigo')) return 'perigo';
  if (s.includes('atenção') || s.includes('alerta')) return 'atencao';
  if (s.includes('emergência') || s.includes('urgência')) return 'emergencia';
  return 'info';
}

/**
 * Avisos meteorológicos do INMET para o Rio Grande do Sul.
 * @param {string[]} [municipios] — para localizar cada aviso
 * @returns {Promise<object[]>}
 */
export async function collectInmetAlerts(municipios = []) {
  try {
    const texto = await fetchText(INMET_AVISOS, 25000);
    const data = JSON.parse(texto);
    if (!Array.isArray(data.hoje)) return [];

    return data.hoje
      .filter((aviso) => String(aviso.estados || '').toLowerCase().includes('rio grande do sul'))
      .map((aviso) => {
        const riscos = Array.isArray(aviso.riscos) ? aviso.riscos.join(' ') : (aviso.riscos || '');
        return {
          id: `inmet-${aviso.id || aviso.id_aviso || hash(String(aviso.descricao) + aviso.data_inicio)}`,
          type: aviso.descricao || 'Alerta',
          severity: mapINMETSeverity(aviso.severidade),
          title: aviso.descricao || 'Aviso meteorológico',
          message: riscos,
          // O aviso do INMET vem com centenas de geocodes; guardamos os nomes
          // de município que interessam, não a lista inteira.
          regions: extractRegions(`${aviso.descricao} ${riscos} ${aviso.municipios || ''}`, municipios),
          issuedAt: aviso.data_inicio || new Date().toISOString(),
          source: 'INMET',
          instructions: Array.isArray(aviso.instrucoes) ? aviso.instrucoes.slice(0, 6) : [],
        };
      });
  } catch (err) {
    console.warn('[collect] INMET avisos indisponível:', err.message);
    return [];
  }
}
