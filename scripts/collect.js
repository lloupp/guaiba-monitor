// collect.js — Coletor server-side (roda no GitHub Actions).
//
// Busca as fontes reais (js/sources.js) e grava os JSONs que o site estático
// lê de mesma origem:
//   data/realtime.json  → leituras das estações + alertas da Defesa Civil RS
//   data/stations.json  → catálogo das estações (nome, bacia, coordenadas)
//   data/history.json   → histórico das estações acompanhadas (72h)
//   data/elnino.json    → anomalias de SST das regiões Niño (NOAA CPC)
//
// Execução:
//   node scripts/collect.js
//
// A coleta em si vive em js/sources.js, compartilhada com o Cloudflare Worker.
// Aqui fica só o que depende de disco.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
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
} from '../js/sources.js';

const DATA_DIR = new URL('../data/', import.meta.url);
const REALTIME_FILE = new URL('realtime.json', DATA_DIR);
const ELNINO_FILE = new URL('elnino.json', DATA_DIR);
const HISTORY_FILE = new URL('history.json', DATA_DIR);
const STATIONS_FILE = new URL('stations.json', DATA_DIR);

/** Grava um JSON no disco. */
async function writeJson(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

/**
 * Atualiza o histórico público (data/history.json), por estação.
 *
 * Guardar 72 h de todas as 130 estações inflaria o repositório a cada coleta,
 * então o arquivo versionado cobre as estações de interesse imediato: as do
 * Lago Guaíba e qualquer estação com alarme oficial ativo. O histórico completo
 * do estado é trabalho do coletor contínuo (Worker + KV), não do git.
 *
 * @param {object[]} stations — leituras da coleta atual
 * @param {string} collectedAt — ISO da coleta
 * @returns {Promise<object>} histórico atualizado
 */
export async function updateHistory(stations, collectedAt) {
  let history = { collectedAt, windowHours: HISTORY_WINDOW_HOURS, stations: {} };
  try {
    const raw = await readFile(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.stations === 'object' && parsed.stations) {
      history = { ...history, stations: parsed.stations };
    }
  } catch {
    // Arquivo ausente ou em formato antigo — recomeça no formato atual.
  }

  const tracked = selectTrackedStations(stations || []);

  for (const station of tracked) {
    const code = station.stationCode;
    const entries = Array.isArray(history.stations[code]) ? history.stations[code] : [];
    const entry = {
      timestamp: station.timestamp || collectedAt,
      levelMeters: station.levelMeters,
      trend: station.trend,
      alarmStatus: station.alarmStatus ?? null,
      rain24h: station.rain24h ?? null,
    };

    const idx = entries.findIndex((e) => e.timestamp === entry.timestamp);
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);

    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const cutoff = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
    history.stations[code] = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  }

  history.collectedAt = collectedAt;
  history.windowHours = HISTORY_WINDOW_HOURS;
  await writeJson(HISTORY_FILE, history);
  return history;
}

/** Executa a coleta completa e grava os JSONs. */
async function main() {
  const collectedAt = new Date().toISOString();
  // O nível vem primeiro porque é dele que saem os municípios usados para
  // localizar os alertas da Defesa Civil.
  const [levelResult, elnino] = await Promise.all([collectLevel(), collectElNino()]);

  const stations = levelResult ? levelResult.stations : [];
  const primary = levelResult ? levelResult.primary : null;
  const municipios = municipiosFromStations(stations);
  const [dcrsAlerts, inmetAlerts] = await Promise.all([
    collectDcrsAlerts(municipios),
    collectInmetAlerts(municipios),
  ]);

  await writeJson(REALTIME_FILE, {
    collectedAt,
    // `level` = estação principal; `stations` = leituras de todo o estado.
    // Bacia, coordenadas e altitude ficam só em stations.json (mudam raramente):
    // repeti-las aqui a cada 30 min triplicava o payload baixado no celular.
    source: 'Defesa Civil RS (Rede Hidrometeorológica)',
    level: primary ? toRealtimeReading(primary) : null,
    stations: stations.map(toRealtimeReading),
    dcrsAlerts,
    inmetAlerts,
    sources: [
      'Defesa Civil RS (RSS)',
      ...(inmetAlerts.length > 0 ? ['INMET (avisos)'] : []),
      ...(stations.length > 0 ? ['Defesa Civil RS (GraphQL — Rede Hidrometeorológica)'] : []),
    ],
  });

  if (stations.length > 0) {
    await writeJson(STATIONS_FILE, {
      collectedAt,
      count: stations.length,
      stations: buildStationCatalog(stations),
    });
  }

  const historyResult = await updateHistory(stations, collectedAt);

  if (elnino) await writeJson(ELNINO_FILE, elnino);

  const emAlarme = stations.filter((s) => Number(s.alarmStatus) > 0);

  console.log(JSON.stringify({
    ok: true,
    estacoes: stations.length,
    principal: primary ? `${primary.stationName}: ${primary.levelMeters} m` : 'nenhuma',
    emAlarme: emAlarme.map((s) => `${s.stationName} (status ${s.alarmStatus})`),
    elnino: elnino ? `${elnino.state} (Nino3.4 ${elnino.regions.nino34.ssta.toFixed(2)}°C)` : 'null',
    dcrsAlerts: dcrsAlerts.length,
    inmetAlerts: inmetAlerts.length,
    historicoEstacoes: Object.keys(historyResult.stations).length,
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
