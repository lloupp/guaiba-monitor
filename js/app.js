// app.js — Lógica principal do Guaiba Monitor
// Fase 2 + Fase 3 + Fase 5 + Fase 6: Layout/Dashboard + Coleta + Riscos + Alertas
//
// app.js é o entry point único (index.html carrega apenas este módulo).
// Importa utils.js, api.js, levels.js, risks.js e alerts.js via import.
import { formatMeters, formatDate, saveToStorage, loadFromStorage, escapeHtml, normalizePlace, placesFromStationName } from './utils.js';
import { fetchAll, invalidateCaches, ageMs, fetchStations, nearestStation } from './api.js';
import { isPushSupported, getPushConfig, isSubscribed, subscribe as pushSubscribe, unsubscribe as pushUnsubscribe, updateStation as pushUpdateStation } from './push.js';
import { appendLevelReading, getLevelHistory, renderLevelChart, attachChartInteractivity, MAIO_2024_LEVEL } from './levels.js';
import { loadConfig, getStationThresholds, getStationInfo } from './config.js';
import { renderElNinoMap, renderElNinoRegions, renderElNinoStatus } from './elnino.js';
import { loadLeaflet, quandoVisivel } from './leaflet-loader.js';
import { getMyLevel, setMyLevel, riseRatePerHour, statusMyLevel, textoParaCompartilhar } from './my-level.js';
import { prepareShelters } from './shelters.js';
import {
  DISASTER_TYPES,
  DISASTER_ORDER,
  buildRegionRisks,
  getRegionOverallRisk,
  getRisksByRegion,
  formatRiskLevel,
  riskRank,
  getOrientation,
} from './risks.js';
import {
  sortAlertsBySeverity,
  formatAlertForDisplay,
  showToast,
  checkLevelThreshold,
  classifyReading,
  requestNotificationPermission,
  disableNotifications,
  notificationsEnabled,
} from './alerts.js';

// REGRA DA FASE 0: nada de leitura inventada. Sem dado real, a interface
// mostra estado vazio com o motivo — ver renderLevelIndicator/renderEmptyState.

// Intervalo de atualização automática dos dados (5 minutos)
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// === Estado da aplicação ===
const state = {
  level: null,
  stations: [],
  regions: [],
  nearest: loadFromStorage('settings.nearest', null),
  alerts: [],
  elnino: null,
  publicHistory: null,
  chartReadings: [],
  myLevelStatus: null,
  shelters: null,
  nearestPosition: loadFromStorage('settings.position', null),
  riskMatrix: [],
  selectedStation: loadFromStorage('settings.selectedStation', null),
  alertThreshold: loadFromStorage('settings.alertThreshold', null),
  dataSources: {},
  diagnostics: {},
  collectedAt: null,
  theme: loadFromStorage('settings.theme', 'dark'),
  loading: true,
  lastFetch: null
};

// === Funções de classificação ===

/**
 * Mapeia tendência para ícone e texto.
 * @param {string} trend — 'subindo' | 'descendo' | 'estavel'
 */
function getTrendInfo(trend) {
  const map = {
    subindo:  { icon: '↗', text: 'Subindo' },
    descendo: { icon: '↘', text: 'Descendo' },
    estavel:  { icon: '→', text: 'Estável' }
  };
  return map[trend] || map.estavel;
}

/**
 * Orientação da região, coerente com a base de classificação disponível.
 * @param {object} reading — leitura da estação (com thresholds e alarmStatus)
 * @returns {string}
 */
function getRegionNote(reading) {
  const classification = classifyReading(reading, reading.thresholds);
  const local = reading.location || reading.name;
  const nivel = formatMeters(reading.levelMeters);

  if (classification.kind === 'cota') {
    const l = parseFloat(reading.levelMeters);
    const t = reading.thresholds;
    if (l >= t.critica) return `Nível CRÍTICO em ${local}. Evacuação emergencial imediata. Afastar-se de margens e vias alagadas.`;
    if (l >= t.severa) return `${local} em nível severo (${nivel}). Risco de inundações avançadas. Redobre a atenção.`;
    if (l >= t.inundacao) return `${local} acima da cota de inundação (${nivel}). Áreas baixas em risco. Monitore atualizações.`;
    if (l >= t.atencao) return `${local} no limite de atenção (${nivel}). Vigiar evolução.`;
    return `${local} com nível normal (${nivel}). Monitorar periodicamente.`;
  }

  if (classification.kind === 'alarme') {
    return classification.status === 'alarme'
      ? `Alarme oficial de inundação em ${local} (${nivel}). Siga as orientações da Defesa Civil RS.`
      : `${local} em ${nivel}, sem alarme oficial de inundação. ${classification.basis}`;
  }

  return `${local} em ${nivel}. ${classification.basis}`;
}

/**
 * Converte uma leitura de nível (LevelReading) para o formato de card de região.
 */
function levelToRegion(levelReading) {
  return {
    id: levelReading.station,
    name: levelReading.location,
    levelMeters: levelReading.levelMeters,
    trend: levelReading.trend,
    thresholds: levelReading.thresholds || null,
    alarmStatus: levelReading.alarmStatus ?? null,
    basin: levelReading.basin || null,
    latitude: levelReading.latitude ?? null,
    longitude: levelReading.longitude ?? null,
    rain24h: levelReading.rain24h ?? null,
    recordedAt: levelReading.recordedAt,
    note: getRegionNote(levelReading),
    source: levelReading.source,
  };
}

/**
 * Estações a exibir como cards: a selecionada primeiro, depois as vizinhas da
 * mesma bacia (ou as mais próximas, quando a bacia não é conhecida).
 * @param {object[]} stations
 * @param {object|null} current
 * @returns {object[]}
 */
function neighbourStations(stations, current) {
  if (!current) return [];
  const MAX_CARDS = 6;
  const sameBasin = current.basin
    ? stations.filter((s) => s.basin === current.basin && s.station !== current.station)
    : [];

  const byDistance = (a, b) => {
    if (current.latitude == null) return 0;
    const d = (s) => Math.hypot((s.latitude ?? 0) - current.latitude, (s.longitude ?? 0) - current.longitude);
    return d(a) - d(b);
  };

  const pool = (sameBasin.length > 0
    ? sameBasin
    : stations.filter((s) => s.station !== current.station)
  ).sort(byDistance);

  return [current, ...pool.slice(0, MAX_CARDS - 1)];
}

// === Carregamento de dados ===

/**
 * Carrega os dados disponíveis e atualiza o estado.
 * Sem dado real, o estado fica vazio e `diagnostics` guarda o motivo — a
 * interface mostra isso ao usuário em vez de preencher com exemplo.
 */
async function loadData() {
  try {
    const data = await fetchAll();

    state.diagnostics = data.diagnostics;
    state.dataSources = data.sources;
    state.collectedAt = data.level.collectedAt || null;

    // Nível: uma entrada por estação, com as cotas da própria régua.
    const stations = data.level.stations.map((s) => ({
      ...s,
      thresholds: getStationThresholds(s.station),
    }));
    state.stations = stations;

    // Estação exibida: a escolhida pela pessoa > a mais próxima dela > a principal.
    const preferred = state.selectedStation || state.nearest?.code || data.level.primaryCode;
    state.level = stations.find((s) => s.station === preferred) || stations[0] || null;

    // Cards de contexto: a estação exibida e as vizinhas da mesma bacia —
    // rio acima e rio abaixo é o que ajuda a antecipar o que vem.
    state.regions = neighbourStations(stations, state.level).map(levelToRegion);

    // Alertas: só os reais (INMET + Defesa Civil RS).
    state.alerts = data.alerts;

    state.elnino = data.elnino || null;
    state.publicHistory = data.history || null;
    state.shelters = data.shelters || null;

    state.riskMatrix = state.regions.length > 0
      ? buildRegionRisks(state.regions, state.alerts, state.level, state.dataSources)
      : [];

    saveToStorage('levels', stations);
    saveToStorage('alerts', state.alerts);
    saveToStorage('data_sources', state.dataSources);
  } catch (err) {
    console.error('[app] Erro ao carregar dados:', err.message);
    state.level = null;
    state.regions = [];
    state.alerts = [];
    state.riskMatrix = [];
    state.diagnostics = { level: 'erro-coleta', inmet: 'erro-coleta', dcrs: 'erro-coleta' };
    state.dataSources = {};
  } finally {
    state.loading = false;
    state.lastFetch = new Date();

    if (state.level) {
      appendLevelReading(state.level);
      checkLevelThreshold(state.level, state.alertThreshold, state.level.thresholds);
    }
    updateStaleBanner();
  }
}

// === Renderização ===

/**
 * Renderiza o indicador de nível atual.
 * Sem leitura, mostra estado vazio com o motivo — nunca um número inventado.
 */
function renderLevelIndicator() {
  const badge = document.getElementById('level-badge');
  const source = document.getElementById('level-source');
  const meters = document.getElementById('level-meters');
  const cota = document.getElementById('cota-transbordo');
  const refEl = document.getElementById('level-ref-2024');
  const trendEl = document.getElementById('level-trend');
  const basisEl = document.getElementById('level-basis');
  const indicator = document.getElementById('level-indicator');

  const level = state.level;

  if (!level) {
    indicator?.classList.add('level-indicator--empty');
    badge.textContent = 'SEM LEITURA';
    badge.className = 'level-badge badge-desconhecido';
    source.textContent = 'nenhuma fonte respondeu';
    meters.textContent = '--';
    cota.textContent = '—';
    if (refEl) refEl.hidden = true;
    trendEl.innerHTML = `<span>${escapeHtml(explainMissingLevel())}</span>`;
    if (basisEl) basisEl.textContent = '';
    return;
  }

  indicator?.classList.remove('level-indicator--empty');

  const classification = classifyReading(level, level.thresholds);
  const trend = getTrendInfo(level.trend);

  badge.textContent = classification.label;
  badge.className = `level-badge badge-${classification.css}`;

  source.textContent = level.source;
  meters.textContent = level.levelMeters.toFixed(2);

  const stationInfo = getStationInfo(level.station);
  // O pico de 2024 é da régua do Cais Mauá: só comparável em réguas com cota.
  if (refEl) refEl.hidden = !level.thresholds;
  cota.textContent = level.thresholds
    ? `${level.thresholds.inundacao.toFixed(2)} m`
    : 'sem cota publicada';
  cota.title = level.thresholds
    ? `Cota de inundação da régua ${stationInfo?.name || level.station}`
    : 'A Defesa Civil RS não publica cota numérica de inundação para esta régua.';

  trendEl.innerHTML = `<span class="trend-icon">${trend.icon}</span><span>${trend.text} · leitura de ${relativeTime(level.recordedAt)}</span>`;
  if (basisEl) basisEl.textContent = classification.basis;
}

/**
 * Explica, em uma frase, por que não há leitura para mostrar.
 * @returns {string}
 */
function explainMissingLevel() {
  const reason = state.diagnostics?.level;
  if (reason === 'sem-conexao') return 'Sem conexão com o servidor de dados — nada foi carregado ainda.';
  if (reason === 'coleta-sem-nivel') return 'A última coleta do servidor não trouxe nível de nenhuma estação.';
  if (reason === 'erro-coleta') return 'Erro ao carregar os dados. Tentando de novo no próximo ciclo.';
  return 'Nenhuma leitura disponível no momento.';
}

/**
 * Texto relativo de tempo decorrido desde o registro da leitura.
 * @param {string} iso — timestamp ISO da leitura
 * @returns {string} ex.: "há 2h", "há 5min"
 */
function relativeTime(iso) {
  if (!iso) return 'agora';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60 * 1000) return 'agora';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `há ${mins}min`;
  const hrs = Math.floor(mins / 60);
  return `há ${hrs}h`;
}

/**
 * Renderiza o gráfico de histórico do nível em Canvas.
 * Usa o histórico público (data/history.json, 7 dias reais coletados pelo
 * Actions) quando disponível — mesclado com o localStorage do navegador
 * para preencher lacunas. Se não há histórico público, usa só o local.
 */
function renderChart() {
  const canvas = document.getElementById('level-canvas');
  if (!canvas) return;

  // Linha de transbordo: só quando a régua exibida tem cota própria.
  const threshold = state.level?.thresholds ? state.level.thresholds.inundacao : null;

  // Histórico público do servidor (data/history.json), já por estação.
  const stationId = state.selectedStation || state.level?.station || null;
  let publicReadings = [];
  const publicByStation = state.publicHistory && state.publicHistory.stations;
  if (stationId && publicByStation && Array.isArray(publicByStation[stationId])) {
    publicReadings = publicByStation[stationId]
      .filter((r) => r && r.levelMeters != null && r.timestamp)
      .map((r) => ({
        station: stationId,
        location: state.level?.location || stationId,
        levelMeters: parseFloat(r.levelMeters),
        trend: typeof r.trend === 'number'
          ? (r.trend > 0.005 ? 'subindo' : r.trend < -0.005 ? 'descendo' : 'estavel')
          : (r.trend || 'estavel'),
        recordedAt: r.timestamp,
        source: 'Defesa Civil RS',
      }));
  }

  // Histórico local do navegador (o que este aparelho já viu desta estação)
  const localHistory = stationId ? getLevelHistory(stationId) : [];

  // Mescla: combina públicos + locais, deduplica por minuto
  const stationKey = stationId || 'público';
  const minuteKey = (iso) => iso ? iso.slice(0, 16) : '';
  const seen = new Set();
  const merged = [...publicReadings, ...localHistory]
    .filter(r => {
      const key = `${r.station || stationKey}|${minuteKey(r.recordedAt)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  // Guarda leituras para o callback de interatividade do gráfico
  state.chartReadings = merged;

  renderLevelChart(canvas, merged, threshold, threshold != null ? MAIO_2024_LEVEL : null);

  // Atualiza metadados abaixo do gráfico
  const countEl = document.getElementById('graph-count');
  const sourceEl = document.getElementById('graph-source');
  if (countEl) {
    const source = publicReadings.length > 0 ? 'público + local' : 'local';
    countEl.textContent = merged.length > 0
      ? `${merged.length} leitura(s) — ${source} — última: ${formatDate(merged[merged.length - 1].recordedAt)}`
      : 'Sem histórico';
  }
  if (sourceEl) {
    const bacia = state.level?.basin
      ? `${state.level.basin.replace(/^RS - /, '')}${state.level.basinInferred ? ' (bacia aproximada)' : ''} · `
      : '';
    const src = bacia + (state.dataSources.level || 'sem fonte disponível');
    sourceEl.textContent = publicReadings.length > 0
      ? `${src} (histórico público: ${publicReadings.length} leituras)`
      : src;
  }
}

/**
 * Renderiza os cards por região (uma estação por card).
 * Sem estações, mostra estado vazio explicando o motivo.
 */
function renderRegions() {
  const grid = document.getElementById('region-grid');
  grid.innerHTML = '';

  if (state.regions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'region-empty';
    empty.textContent = explainMissingLevel();
    grid.appendChild(empty);
    return;
  }

  state.regions.forEach(region => {
    const classification = classifyReading(region, region.thresholds);
    const trend = getTrendInfo(region.trend);
    const overall = getRegionOverallRisk(state.riskMatrix, region.name);
    const overallFmt = overall ? formatRiskLevel(overall.riskLevel) : null;
    const riskCause = overall ? (DISASTER_TYPES[overall.disasterType]?.label || overall.disasterType) : '';

    const card = document.createElement('div');
    card.className = 'region-card';
    card.dataset.region = region.id;
    card.innerHTML = `
      <div class="region-header">
        <span class="region-name">${escapeHtml(region.name)}</span>
        <span class="region-risk badge-${classification.css}">${classification.label}</span>
      </div>
      <div class="region-level">${formatMeters(region.levelMeters)}</div>
      <div class="region-trend">
        <span class="trend-icon">${trend.icon}</span>
        <span>${trend.text}</span>
        ${region.rain24h != null ? `<span class="region-rain" title="Chuva acumulada em 24h">🌧️ ${region.rain24h.toFixed(1)} mm/24h</span>` : ''}
      </div>
      <div class="region-risk-summary">
        <span class="region-risk-label">Risco geral:</span>
        ${overallFmt ? `<span class="region-risk-badge badge-${overallFmt.badgeClass}">${overallFmt.icon} ${overallFmt.label}</span>${riskCause ? `<span class="region-risk-cause">(${escapeHtml(riskCause)})</span>` : ''}` : '<span class="region-risk-badge badge-desconhecido">⚪ Sem referência</span>'}
      </div>
      <p class="region-note">${escapeHtml(region.note)}</p>
    `;
    grid.appendChild(card);
  });
}

/**
 * Atualiza o indicador de tema (ícone do toggle).
 */
function renderThemeIcon() {
  const icon = document.getElementById('theme-icon');
  icon.textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

/**
 * Aplica o tema claro/escuro ao documento.
 */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

/**
 * Atualiza o timestamp da última atualização no footer.
 * Torna o parágrafo "stale" se os dados não são atualizados há muito tempo.
 */
function updateTimestamp() {
  const now = new Date();
  const el = document.getElementById('last-update');
  el.textContent = formatDate(now.toISOString());

  const stale = state.lastFetch && (now.getTime() - state.lastFetch.getTime()) > REFRESH_INTERVAL_MS * 2;
  const para = el.closest('p');
  if (para) para.classList.toggle('stale', !!stale);
}

/**
 * Atualiza o indicador de fonte de dados no footer.
 */
function updateDataSource() {
  const sources = Object.entries(state.dataSources || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  const unavailable = Object.entries(state.diagnostics || {})
    .filter(([, v]) => v !== 'ok')
    .map(([k]) => k);

  const parts = [];
  if (sources.length > 0) parts.push(sources.join(' | '));
  if (unavailable.length > 0) parts.push(`indisponível: ${unavailable.join(', ')}`);

  document.getElementById('data-source').textContent = parts.join(' — ') || 'nenhuma fonte respondeu';
}

/**
 * Remove o loader após o conteúdo estar pronto.
 */
function fadeOutLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  setTimeout(() => {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 500);
  }, 400);
}

/**
 * Renderiza a matriz de risco (região × tipo de desastre).
 * Fase 5: tabela com badges de risco colorido + texto de orientação.
 * Cada célula é clicável e leva à orientação correspondente na seção abaixo.
 */
function renderRiskMatrix() {
  const container = document.getElementById('risk-matrix');
  if (!container) return;

  // Determina regiões únicas (mantém ordem de state.regions)
  const regionNames = state.regions.map(r => r.name);

  if (regionNames.length === 0) {
    container.innerHTML = `<p class="risk-empty">${escapeHtml(explainMissingLevel())}</p>`;
    const orientationEmpty = document.getElementById('risk-orientation');
    if (orientationEmpty) orientationEmpty.innerHTML = '';
    return;
  }

  // === Tabela da matriz ===
  const table = document.createElement('table');
  table.className = 'risk-table';

  // Header
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const regionTh = document.createElement('th');
  regionTh.textContent = 'Região';
  headRow.appendChild(regionTh);
  DISASTER_ORDER.forEach(key => {
    const th = document.createElement('th');
    th.textContent = `${DISASTER_TYPES[key].icon} ${DISASTER_TYPES[key].label}`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  // Body — uma linha por região
  const tbody = document.createElement('tbody');
  regionNames.forEach(regionName => {
    const risks = getRisksByRegion(state.riskMatrix, regionName);
    const row = document.createElement('tr');

    const regionCell = document.createElement('td');
    regionCell.className = 'risk-region-cell';
    regionCell.textContent = regionName;
    row.appendChild(regionCell);

    DISASTER_ORDER.forEach(disasterKey => {
      const cell = document.createElement('td');
      const risk = risks.find(r => r.disasterType === disasterKey);
      if (!risk) {
        cell.className = 'risk-blank';
        cell.textContent = '—';
      } else {
        const fmt = formatRiskLevel(risk.riskLevel);
        cell.className = 'risk-cell';
        cell.dataset.risk = fmt.css;
        cell.dataset.region = regionName;
        cell.dataset.disaster = disasterKey;
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `${regionName} — ${DISASTER_TYPES[disasterKey].label}: ${fmt.label}`);
        const badge = document.createElement('span');
        badge.className = `risk-badge badge-${fmt.badgeClass}`;
        badge.textContent = fmt.label;
        cell.appendChild(badge);
      }
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);

  // === Texto de orientação por região ===
  const orientationEl = document.getElementById('risk-orientation');
  if (!orientationEl) return;

  orientationEl.innerHTML = '';
  regionNames.forEach(regionName => {
    const risks = getRisksByRegion(state.riskMatrix, regionName);
    const overall = getRegionOverallRisk(state.riskMatrix, regionName);
    const overallFmt = overall ? formatRiskLevel(overall.riskLevel) : formatRiskLevel('baixo');
    const block = document.createElement('div');
    block.className = 'orientation-block';
    block.dataset.region = regionName;

    const header = document.createElement('div');
    header.className = 'orientation-header';
    const regionSpan = document.createElement('span');
    regionSpan.className = 'orientation-region';
    regionSpan.textContent = regionName;
    const badgeSpan = document.createElement('span');
    badgeSpan.className = `orientation-badge badge-${overallFmt.badgeClass}`;
    badgeSpan.textContent = `${overallFmt.icon} ${overallFmt.label}`;
    header.appendChild(regionSpan);
    header.appendChild(badgeSpan);
    block.appendChild(header);

    const content = document.createElement('div');
    content.className = 'orientation-content';
    risks
      .filter(r => riskRank(r.riskLevel) > 0)  // só riscos acima de "baixo"
      .sort((a, b) => riskRank(b.riskLevel) - riskRank(a.riskLevel))
      .forEach(r => {
        const item = document.createElement('div');
        item.className = 'orientation-item';
        item.dataset.disaster = r.disasterType;

        const disasterSpan = document.createElement('span');
        disasterSpan.className = 'orientation-disaster';
        disasterSpan.textContent = `${DISASTER_TYPES[r.disasterType]?.icon || '⚠️'} ${DISASTER_TYPES[r.disasterType]?.label || r.disasterType}`;

        const textSpan = document.createElement('span');
        textSpan.className = 'orientation-text';
        textSpan.textContent = getOrientation(r.disasterType, r.riskLevel);

        item.appendChild(disasterSpan);
        item.appendChild(textSpan);
        content.appendChild(item);
      });
    block.appendChild(content);
    orientationEl.appendChild(block);
  });

  // === Clique/teclado nas células → destaca a orientação correspondente ===
  table.addEventListener('click', onRiskCellActivate);
  table.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('risk-cell')) {
      e.preventDefault();
      onRiskCellActivate(e);
    }
  });
}

/**
 * Move o foco para a orientação do desastre/região clicados na matriz.
 * @param {Event} e
 */
function onRiskCellActivate(e) {
  const cell = e.target.closest('.risk-cell');
  if (!cell) return;
  const region = cell.dataset.region;
  const disaster = cell.dataset.disaster;

  const orientationEl = document.getElementById('risk-orientation');
  if (!orientationEl) return;

  // Remove destaques anteriores
  orientationEl.querySelectorAll('.orientation-item.highlight, .orientation-block.highlight')
    .forEach(el => el.classList.remove('highlight'));

  const block = orientationEl.querySelector(`.orientation-block[data-region="${CSS.escape(region)}"]`);
  if (block) {
    block.classList.add('highlight');
    const item = block.querySelector(`.orientation-item[data-disaster="${CSS.escape(disaster)}"]`);
    if (item) item.classList.add('highlight');
    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * O alerta fala da região que a pessoa acompanha?
 *
 * Vale para: alerta estadual (sem município identificado), alerta que cita o
 * município da estação exibida, ou que cita o município de alguma estação da
 * mesma bacia — água que sobe rio acima chega rio abaixo.
 *
 * @param {object} alert
 * @returns {boolean}
 */
function alertIsRelevant(alert) {
  const regions = Array.isArray(alert.regions) ? alert.regions : [];
  if (regions.length === 0) return true;
  if (regions.some((r) => normalizePlace(r) === 'rio grande do sul')) return true;

  const meus = new Set();
  const add = (name) => placesFromStationName(name).forEach((p) => meus.add(normalizePlace(p)));
  if (state.level) add(state.level.location);
  state.regions.forEach((r) => add(r.name));

  return regions.some((r) => {
    const alvo = normalizePlace(r);
    return [...meus].some((m) => alvo.includes(m) || m.includes(alvo));
  });
}

/**
 * Monta o card de um alerta.
 * @param {object} alert
 * @returns {HTMLElement}
 */
function buildAlertCard(alert) {
  const display = formatAlertForDisplay(alert);
  const sev = display.severityInfo;
  const regionsText = display.regions.length > 0 ? display.regions.join(', ') : 'Todas as regiões';

  const instructionsHtml = display.instructions && display.instructions.length > 0
    ? `
      <div class="alert-card-instructions">
        <strong>Orientações:</strong>
        <ul>${display.instructions.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      </div>
    `
    : '';

  const card = document.createElement('div');
  card.className = `alert-card alert-card--${sev.css}`;
  card.setAttribute('data-alert-id', display.id);
  card.innerHTML = `
    <div class="alert-card-header">
      <div class="alert-card-title">
        <span class="alert-icon">${sev.icon}</span>
        ${escapeHtml(display.title)}
      </div>
      <div class="alert-card-meta">
        <span class="alert-card-type">${escapeHtml(display.type)}</span>
        <span class="alert-card-badge badge-${sev.badgeClass}">${sev.label}</span>
      </div>
    </div>
    <div class="alert-card-message">${escapeHtml(display.message)}</div>
    <div class="alert-card-source">
      <span class="alert-source-loc">📍 ${escapeHtml(regionsText)}</span>
      <span class="alert-pipe">•</span>
      <span class="alert-source-name">${escapeHtml(display.source)}</span>
      <span class="alert-pipe">•</span>
      <span class="alert-time">${formatDate(display.issuedAt)}</span>
    </div>
    ${instructionsHtml}
  `;
  return card;
}

/**
 * Renderiza os alertas oficiais (INMET + Defesa Civil RS), do mais grave para
 * o menos grave. Os que não têm a ver com a região exibida ficam recolhidos:
 * ver alerta de outra ponta do estado como se fosse seu cansa e faz ignorar o
 * alerta que importa.
 */
function renderAlerts() {
  const listEl = document.getElementById('alerts-list');
  const emptyEl = document.getElementById('alerts-empty');
  if (!listEl || !emptyEl) return;

  const sorted = sortAlertsBySeverity(state.alerts);
  const meus = sorted.filter(alertIsRelevant);
  const outros = sorted.filter((a) => !alertIsRelevant(a));

  listEl.innerHTML = '';

  const unavailable = [];
  if (state.diagnostics?.inmet === 'indisponivel') unavailable.push('INMET');
  if (state.diagnostics?.dcrs === 'indisponivel') unavailable.push('Defesa Civil RS');

  if (meus.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = unavailable.length > 0
      ? `<span>⚠️ Sem alertas para mostrar — fonte indisponível: ${escapeHtml(unavailable.join(', '))}.</span>`
      : '<span>✅ Nenhum alerta ativo para a sua região.</span>';
  } else {
    listEl.style.display = 'flex';
    emptyEl.style.display = 'none';
    meus.forEach((a) => listEl.appendChild(buildAlertCard(a)));
  }

  if (unavailable.length > 0 && meus.length > 0) {
    const note = document.createElement('p');
    note.className = 'alerts-source-note';
    note.textContent = `Fonte indisponível no momento: ${unavailable.join(', ')}. A lista pode estar incompleta.`;
    listEl.appendChild(note);
  }

  renderOtherAlerts(outros);
}

/**
 * Alertas de outras regiões do estado, recolhidos.
 * @param {object[]} outros
 */
function renderOtherAlerts(outros) {
  const container = document.getElementById('alerts-other');
  if (!container) return;
  container.innerHTML = '';

  if (outros.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const details = document.createElement('details');
  details.className = 'alerts-other-details';
  const summary = document.createElement('summary');
  summary.textContent = `Alertas de outras regiões do RS (${outros.length})`;
  details.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'alerts-list';
  outros.forEach((a) => list.appendChild(buildAlertCard(a)));
  details.appendChild(list);
  container.appendChild(details);
}

// === Checklist de preparação (Fase 7) ===

/**
 * Carrega o estado dos checkboxes do localStorage (prefixo gm_).
 * @returns {Object} mapa de data-key → boolean
 */
function loadChecklistState() {
  return loadFromStorage('checklist', {});
}

/**
 * Salva o estado dos checkboxes no localStorage (prefixo gm_).
 * @param {Object} state — mapa de data-key → boolean
 */
function saveChecklistState(state) {
  saveToStorage('checklist', state);
}

/**
 * Renderiza o checklist de preparação: aplica estados salvos nos checkboxes,
 * atualiza a barra de progresso e registra listeners para persistir.
 */
function renderPreparationChecklist() {
  const checkboxes = document.querySelectorAll('.checklist input[type="checkbox"]');
  if (checkboxes.length === 0) return;

  const saved = loadChecklistState();
  let checked = 0;
  const total = checkboxes.length;

  checkboxes.forEach(cb => {
    const key = cb.getAttribute('data-key');
    const isChecked = !!saved[key];
    cb.checked = isChecked;
    if (isChecked) checked++;

    // Aplica estilo do label (line-through) imediatamente
    const label = cb.closest('.checklist-item');
    if (label) {
      label.classList.toggle('checked-state', isChecked);
    }

    cb.removeEventListener('change', onChecklistChange);
    cb.addEventListener('change', onChecklistChange);
  });

  updateProgress(checked, total);
}

/**
 * Liga o campo "para onde eu vou" ao localStorage (fica só neste aparelho).
 */
function renderSafePoint() {
  const el = document.getElementById('safe-point');
  if (!el) return;
  el.value = loadFromStorage('safePoint', '') || '';
  el.addEventListener('input', () => {
    saveToStorage('safePoint', el.value);
  });
  el.addEventListener('blur', () => {
    if (el.value.trim()) showToast('Plano de saída salvo neste aparelho.', { type: 'success', duration: 2500 });
  });
}

/**
 * Handler para change nos checkboxes do checklist.
 * Persiste no localStorage e atualiza a barra de progresso.
 * @param {Event} e
 */
function onChecklistChange(e) {
  const cb = e.target;
  const key = cb.getAttribute('data-key');
  if (!key) return;

  const saved = loadChecklistState();
  saved[key] = cb.checked;
  saveChecklistState(saved);

  const total = document.querySelectorAll('.checklist input[type="checkbox"]').length;
  const checked = document.querySelectorAll('.checklist input[type="checkbox"]:checked').length;
  updateProgress(checked, total);

  // Feedback toast ao marcar/desmarcar
  const label = cb.closest('.checklist-item');
  if (label) label.classList.toggle('checked-state', cb.checked);
  if (checked === total) {
    showToast('Parabéns — checklist completo! 🎉', { type: 'success', duration: 3000 });
  }
}

/**
 * Atualiza a barra de progresso do checklist.
 * @param {number} checked
 * @param {number} total
 */
function updateProgress(checked, total) {
  const textEl = document.getElementById('prep-progress-text');
  const barEl = document.getElementById('prep-progress-bar');
  if (textEl) textEl.textContent = `${checked}/${total} itens concluídos`;
  const pct = total > 0 ? (checked / total) * 100 : 0;
  if (barEl) {
    barEl.style.width = `${pct}%`;
    barEl.classList.toggle('full', pct === 100);
  }
}

/**
 * Aplica animações de entrada escalonadas (stagger) nos cards principais.
 * Executado uma vez após o primeiro render.
 */
function applyEntryAnimations() {
  const sections = document.querySelectorAll('.level-indicator, .cota-legend, .level-graph, .regions, .risk-matrix-section, .alerts-section, .preparation-section');
  sections.forEach((el, i) => {
    el.style.animationDelay = `${0.05 + i * 0.08}s`;
    el.classList.add('animate-fadeInUp');
  });
}

/**
 * Modo emergência: uma tela com o essencial, legível de longe e funcionando
 * sem rede. É o que a pessoa abre quando não dá tempo de ler um dashboard.
 */
function renderEmergencyScreen() {
  const nivelEl = document.getElementById('emergency-level');
  const metaEl = document.getElementById('emergency-level-meta');
  const acaoEl = document.getElementById('emergency-action');
  const planoEl = document.getElementById('emergency-plan');
  const kitEl = document.getElementById('emergency-kit');
  if (!nivelEl) return;

  if (state.level) {
    const classificacao = classifyReading(state.level, state.level.thresholds);
    nivelEl.textContent = `${state.level.levelMeters.toFixed(2)} m`;
    nivelEl.className = `emergency-level emergency-level--${classificacao.css}`;
    metaEl.textContent = `${state.level.location} · leitura de ${relativeTime(state.level.recordedAt)} · ${classificacao.label}`;
    acaoEl.textContent = acaoEmergencia(classificacao);
  } else {
    nivelEl.textContent = '--';
    nivelEl.className = 'emergency-level';
    metaEl.textContent = explainMissingLevel();
    acaoEl.textContent = 'Sem leitura agora. Em risco imediato, ligue 193 (Bombeiros) ou 199 (Defesa Civil).';
  }

  const plano = loadFromStorage('safePoint', '');
  planoEl.textContent = plano
    ? plano
    : 'Você ainda não anotou para onde ir. Escreva isso no app enquanto há tempo — em Checklist de Preparação.';
  planoEl.classList.toggle('emergency-plan--vazio', !plano);

  // Só o que ainda falta do kit: numa saída às pressas, a lista útil é essa.
  const salvos = loadFromStorage('checklist', {}) || {};
  const faltando = [...document.querySelectorAll('.checklist input[type="checkbox"]')]
    .filter((cb) => !salvos[cb.getAttribute('data-key')])
    .map((cb) => cb.closest('.checklist-item')?.textContent.trim())
    .filter(Boolean);

  kitEl.innerHTML = '';
  if (faltando.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Seu kit está completo. Pegue e vá.';
    kitEl.appendChild(li);
  } else {
    faltando.slice(0, 6).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      kitEl.appendChild(li);
    });
  }
}

/**
 * O que fazer, na gravidade atual.
 * @param {object} classificacao — de classifyReading
 * @returns {string}
 */
function acaoEmergencia(classificacao) {
  const mensagens = {
    critica: 'Vá para um ponto alto agora. Não atravesse água corrente, nem a pé nem de carro.',
    severa: 'Saia das áreas baixas. Leve documentos, remédios e o carregador.',
    alarme: 'Alarme oficial de inundação nesta estação. Siga a orientação da Defesa Civil (199).',
    inundacao: 'Tire do chão o que não pode molhar e deixe a saída pronta.',
    atencao: 'Acompanhe de perto e separe o que vai levar.',
  };
  return mensagens[classificacao.status] ||
    'Sem alarme no momento. Aproveite para deixar o kit e o plano de saída prontos.';
}

/** Abre ou fecha a tela de emergência. */
function toggleEmergencyScreen(abrir) {
  const tela = document.getElementById('emergency-screen');
  if (!tela) return;
  if (abrir) {
    renderEmergencyScreen();
    tela.hidden = false;
    document.body.classList.add('emergency-open-body');
    document.getElementById('emergency-close')?.focus();
  } else {
    tela.hidden = true;
    document.body.classList.remove('emergency-open-body');
    document.getElementById('emergency-open')?.focus();
  }
}

// === Eventos ===
function handleThemeToggle() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  renderThemeIcon();
  saveToStorage('settings.theme', state.theme);
  // Re-renderiza o gráfico e o mapa El Niño com as cores do novo tema
  renderChart();
  renderElNino();
}

// === Renderização conjunta (usada no init e no refresh automático) ===
/**
 * Renderiza a seção El Niño / La Niña: badge de estado ENSO + mapa das
 * regiões Niño. Se a lib Leaflet não carregou, mostra apenas o status.
 */
function renderElNino() {
  const mapEl = document.getElementById('elnino-map');
  const statusEl = document.getElementById('elnino-status');
  const regionsEl = document.getElementById('elnino-regions');
  if (!statusEl) return;

  if (!state.elnino) {
    statusEl.innerHTML = '<p class="elnino-nodata">Dados de El Niño/La Niña indisponíveis no momento.</p>';
    if (mapEl) mapEl.innerHTML = '';
    if (regionsEl) regionsEl.innerHTML = '';
    return;
  }

  // O texto (que é o que informa) aparece na hora; o mapa espera a rolagem.
  renderElNinoStatus(statusEl, state.elnino);
  if (regionsEl) renderElNinoRegions(regionsEl, state.elnino);
  if (mapEl) desenharMapaElNino(mapEl);
}

// O mapa é carregado sob demanda; depois disso, redesenha direto (troca de
// tema, refresh) sem esperar a rolagem de novo.
let mapaElNinoPronto = false;

/**
 * Desenha o mapa do El Niño quando ele chega perto da tela, carregando o
 * Leaflet nesse momento.
 * @param {HTMLElement} mapEl
 */
function desenharMapaElNino(mapEl) {
  const desenhar = async () => {
    if (!state.elnino) return;
    mapEl.classList.add('elnino-map--carregando');
    const L = await loadLeaflet();
    mapEl.classList.remove('elnino-map--carregando');

    if (!L) {
      mapEl.innerHTML = '<p class="elnino-nodata">Mapa indisponível sem conexão. Os números acima continuam válidos.</p>';
      return;
    }
    mapEl.innerHTML = '';
    renderElNinoMap(mapEl, state.elnino, state.theme === 'dark');
    mapaElNinoPronto = true;
  };

  // Já carregado (troca de tema, refresh): redesenha sem esperar rolagem.
  if (mapaElNinoPronto || window.L) desenhar();
  else quandoVisivel(mapEl, desenhar);
}


/**
 * Atualiza o banner de topo com a idade real dos dados já carregados.
 * Não refaz requisição: usa o collectedAt que veio no ciclo atual.
 */
function updateStaleBanner() {
  const banner = document.getElementById('stale-banner');
  const textEl = document.getElementById('stale-text');
  if (!banner || !textEl) return;

  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 horas

  if (!state.collectedAt) {
    banner.style.display = 'flex';
    textEl.textContent = state.level
      ? 'Sem confirmação da hora da coleta no servidor.'
      : explainMissingLevel();
    return;
  }

  const age = ageMs(state.collectedAt);
  if (age != null && age > STALE_THRESHOLD_MS) {
    const hrs = Math.floor(age / (60 * 60 * 1000));
    const mins = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
    const timeStr = hrs > 0 ? `${hrs}h${mins > 0 ? ' ' + mins + 'min' : ''}` : `${mins}min`;
    banner.style.display = 'flex';
    textEl.textContent = `Dados de ${timeStr} atrás — a coleta do servidor não atualizou desde então.`;
  } else {
    banner.style.display = 'none';
  }
}

/**
 * Renderiza a legenda de faixas da régua exibida.
 * Sem cota oficial, explica isso em vez de mostrar faixas que não existem.
 */
function renderCotaLegend() {
  const el = document.getElementById('cota-legend');
  if (!el) return;

  const t = state.level?.thresholds || null;
  if (!t) {
    el.innerHTML = `<p class="cota-legend-empty">${escapeHtml(
      state.level
        ? 'Esta régua não tem cota oficial de inundação publicada. Acompanhe o número, a tendência e o alarme oficial da Defesa Civil RS.'
        : 'Sem estação selecionada.'
    )}</p>`;
    return;
  }

  const faixas = [
    { css: 'normal', label: 'Normal', range: `0 — ${t.atencao.toFixed(2)} m` },
    { css: 'atencao', label: 'Atenção', range: `${t.atencao.toFixed(2)} — ${t.inundacao.toFixed(2)} m` },
    { css: 'inundacao', label: 'Inundação', range: `${t.inundacao.toFixed(2)} — ${t.severa.toFixed(2)} m` },
    { css: 'severa', label: 'Severa', range: `${t.severa.toFixed(2)} — ${t.critica.toFixed(2)} m` },
    { css: 'critica', label: 'Crítica', range: `${t.critica.toFixed(2)} m+` },
  ];

  const info = getStationInfo(state.level.station);
  el.innerHTML = `
    ${faixas.map(f => `
      <div class="cota-segment">
        <div class="segment-bar badge-${f.css}"></div>
        <div class="segment-label"><span>${f.range}</span><span>${f.label}</span></div>
      </div>
    `).join('')}
    <p class="cota-legend-source">Cotas da régua ${escapeHtml(info?.name || state.level.station)}${info?.thresholdsSource ? ` — fonte: ${escapeHtml(info.thresholdsSource)}` : ''}.</p>
  `;
}

/**
 * Painel "quanto falta até a minha casa": distância em centímetros até a
 * referência da pessoa e, se estiver subindo, o tempo estimado no ritmo atual.
 */
function renderMyLevel() {
  const secao = document.getElementById('my-level');
  const statusEl = document.getElementById('my-level-status');
  const input = document.getElementById('my-level-input');
  const labelInput = document.getElementById('my-level-label');
  const shareBtn = document.getElementById('share-button');
  if (!secao || !statusEl) return;

  if (!state.level) {
    secao.hidden = true;
    return;
  }
  secao.hidden = false;
  if (shareBtn) shareBtn.hidden = !('share' in navigator);

  const minha = getMyLevel(state.level.station);
  if (input) input.value = minha ? String(minha.meters) : '';
  if (labelInput) labelInput.value = minha ? (minha.label || '') : '';

  if (!minha) {
    statusEl.className = 'my-level-status my-level-status--vazio';
    statusEl.textContent = 'Você ainda não marcou a sua referência nesta régua. Sem ela, o número do rio não diz se a água chega até você.';
    return;
  }

  const status = statusMyLevel(state.level.levelMeters, minha.meters, riseRatePerHour(state.chartReadings));
  state.myLevelStatus = status;

  const nome = minha.label ? `${minha.label} — ` : '';
  statusEl.className = `my-level-status ${status.alcancado ? 'my-level-status--passou' : status.subindo ? 'my-level-status--subindo' : 'my-level-status--estavel'}`;
  statusEl.textContent = `${nome}${status.texto}`;
}

/** Manda a situação atual para quem não tem o app (WhatsApp e afins). */
async function compartilharSituacao() {
  if (!state.level || !('share' in navigator)) return;
  const texto = textoParaCompartilhar({
    estacao: state.level.location,
    nivel: state.level.levelMeters,
    quando: formatDate(state.level.recordedAt),
    status: state.myLevelStatus || null,
    url: location.href.split('?')[0],
  });
  try {
    await navigator.share({ title: 'Nível do rio', text: texto });
  } catch {
    // Cancelar o compartilhamento é uma escolha, não um erro.
  }
}

/**
 * Abrigos: só aparecem quando há fonte com procedência. Sem isso, a seção
 * some e vale a orientação que funciona sempre — ligar 199 e perguntar.
 */
function renderShelters() {
  const secao = document.getElementById('shelters-section');
  const lista = document.getElementById('shelters-list');
  const subtitulo = document.getElementById('shelters-subtitle');
  const fallback = document.getElementById('shelters-fallback');
  if (!secao || !lista) return;

  const preparados = prepareShelters(state.shelters, state.nearestPosition);

  if (preparados.shelters.length === 0) {
    secao.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }

  secao.hidden = false;
  if (fallback) fallback.hidden = true;

  subtitulo.textContent = preparados.fonte
    ? `Fonte: ${preparados.fonte}. Confirme por telefone antes de ir — vagas mudam de hora em hora.`
    : 'Confirme por telefone antes de ir — vagas mudam de hora em hora.';

  lista.innerHTML = '';
  preparados.shelters.forEach((abrigo) => {
    const card = document.createElement('div');
    card.className = `shelter-card${abrigo.desatualizado ? ' shelter-card--velho' : ''}`;

    const distancia = abrigo.distanciaKm != null
      ? `<span class="shelter-distance">${abrigo.distanciaKm < 1 ? `${Math.round(abrigo.distanciaKm * 1000)} m` : `${abrigo.distanciaKm.toFixed(1)} km`}</span>`
      : '';

    const marcas = [
      abrigo.petFriendly ? '<span class="shelter-tag">aceita animais</span>' : '',
      abrigo.accessible ? '<span class="shelter-tag">acessível</span>' : '',
      abrigo.capacity ? `<span class="shelter-tag">${abrigo.capacity} vagas</span>` : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
      <div class="shelter-head">
        <span class="shelter-name">${escapeHtml(abrigo.name)}</span>
        ${distancia}
      </div>
      ${abrigo.address ? `<p class="shelter-address">${escapeHtml(abrigo.address)}</p>` : ''}
      ${marcas ? `<div class="shelter-tags">${marcas}</div>` : ''}
      ${abrigo.phone ? `<a class="shelter-phone" href="tel:${escapeHtml(String(abrigo.phone).replace(/\D/g, ''))}">Ligar: ${escapeHtml(abrigo.phone)}</a>` : ''}
      <p class="shelter-source">
        ${escapeHtml(abrigo.source)} · verificado há ${abrigo.diasDesdeVerificacao} dia(s)${abrigo.desatualizado ? ' — <strong>confirme antes de ir</strong>' : ''}
      </p>
    `;
    lista.appendChild(card);
  });
}

function renderAll() {
  renderLevelIndicator();
  renderCotaLegend();
  renderMyLevel();
  populateStationSelector();
  renderChart();
  renderRegions();
  renderRiskMatrix();
  renderAlerts();
  renderElNino();
  renderPreparationChecklist();
  renderShelters();
  updateTimestamp();
  updateDataSource();
}

/**
 * Popula o seletor com todas as estações do estado, agrupadas por bacia.
 * Com 130 estações, o agrupamento é o que torna a lista navegável.
 */
function populateStationSelector() {
  const select = document.getElementById('station-select');
  const wrap = document.getElementById('station-selector');
  if (!select) return;

  select.innerHTML = '';

  if (!state.stations || state.stations.length === 0) {
    select.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    return;
  }
  select.style.display = '';
  if (wrap) wrap.style.display = '';

  const byBasin = new Map();
  state.stations.forEach((s) => {
    const basin = s.basin || 'Outras estações';
    if (!byBasin.has(basin)) byBasin.set(basin, []);
    byBasin.get(basin).push(s);
  });

  // Bacia da estação exibida primeiro; o resto em ordem alfabética.
  const currentBasin = state.level?.basin || null;
  const SEM_BACIA = 'Outras estações';
  const basins = [...byBasin.keys()].sort((a, b) => {
    if (a === currentBasin) return -1;
    if (b === currentBasin) return 1;
    // Estações sem bacia informada vão para o fim da lista.
    if (a === SEM_BACIA) return 1;
    if (b === SEM_BACIA) return -1;
    return a.localeCompare(b, 'pt-BR');
  });

  basins.forEach((basin) => {
    const group = document.createElement('optgroup');
    group.label = basin.replace(/^RS - /, '');
    byBasin.get(basin)
      .sort((a, b) => a.location.localeCompare(b.location, 'pt-BR'))
      .forEach((s) => {
        const option = document.createElement('option');
        option.value = s.station;
        const alarme = Number(s.alarmStatus) > 0 ? ' 🚨' : '';
        option.textContent = `${s.location} (${formatMeters(s.levelMeters)})${alarme}`;
        group.appendChild(option);
      });
    select.appendChild(group);
  });

  if (state.level) select.value = state.level.station;
}

/**
 * Usa a localização (com permissão) para escolher a estação mais próxima.
 * A coordenada não sai do aparelho: o cálculo é local, sobre o catálogo.
 */
async function useMyLocation() {
  const btn = document.getElementById('locate-button');
  if (!('geolocation' in navigator)) {
    showToast('Este aparelho não informa localização.', { type: 'warning' });
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Localizando…'; }

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 5 * 60 * 1000,
      });
    });

    const catalog = await fetchStations();
    const best = nearestStation(catalog?.stations || [], pos.coords.latitude, pos.coords.longitude);
    if (!best) {
      showToast('Não consegui achar uma estação próxima.', { type: 'warning' });
      return;
    }

    state.nearest = { code: best.station.code, distanceKm: Math.round(best.distanceKm) };
    saveToStorage('settings.nearest', state.nearest);
    // Posição arredondada (~1 km) só para ordenar abrigos por distância: não
    // precisa de precisão fina e não sai do aparelho.
    state.nearestPosition = {
      latitude: Math.round(pos.coords.latitude * 100) / 100,
      longitude: Math.round(pos.coords.longitude * 100) / 100,
    };
    saveToStorage('settings.position', state.nearestPosition);
    selectStation(best.station.code);
    showToast(
      `Estação mais próxima: ${best.station.name} (~${Math.round(best.distanceKm)} km).`,
      { type: 'success', duration: 5000 }
    );
  } catch (err) {
    const msg = err && err.code === 1
      ? 'Permissão de localização negada — escolha a estação na lista.'
      : 'Não foi possível obter a localização agora.';
    showToast(msg, { type: 'warning' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📍 Estação mais próxima'; }
  }
}

/**
 * Troca a estação exibida e re-renderiza o que depende dela.
 * @param {string} code
 */
function selectStation(code) {
  const found = state.stations.find((s) => s.station === code);
  if (!found) return;
  state.selectedStation = code;
  saveToStorage('settings.selectedStation', code);
  state.level = found;
  state.regions = neighbourStations(state.stations, found).map(levelToRegion);
  state.riskMatrix = buildRegionRisks(state.regions, state.alerts, state.level, state.dataSources);
  renderAll();

  // Quem trocou de estação quer ser avisado sobre a nova, não sobre a antiga.
  pushUpdateStation(pushContext())
    .then((trocou) => {
      if (trocou) showToast(`Avisos agora são de ${found.location}.`, { type: 'success', duration: 4000 });
    })
    .catch(() => {});
}

/**
 * Atualiza o botão de avisos conforme o estado real (push, local ou nada).
 */
async function updateNotificationButton() {
  const btn = document.getElementById('notification-toggle');
  if (!btn) return;
  const icon = btn.querySelector('.notif-icon');
  const label = btn.querySelector('.notif-label');
  const hint = document.getElementById('notification-hint');
  if (!icon || !label) return;

  const temPush = isPushSupported() && Boolean(await getPushConfig());
  const inscrito = temPush ? await isSubscribed() : false;
  const localAtivo = notificationsEnabled();

  if (inscrito) {
    icon.textContent = '🔔';
    label.textContent = 'Avisos ligados';
    btn.classList.add('notif-active');
    if (hint) hint.textContent = 'Você é avisado mesmo com o app fechado. Toque para desligar.';
  } else if (localAtivo) {
    icon.textContent = '🔔';
    label.textContent = 'Avisos com o app aberto';
    btn.classList.add('notif-active');
    if (hint) {
      hint.textContent = temPush
        ? 'Toque para desligar.'
        : 'Este site ainda não tem servidor de avisos: só avisa com o app aberto.';
    }
  } else {
    icon.textContent = '🔕';
    label.textContent = temPush ? 'Quero ser avisado' : 'Avisar com o app aberto';
    btn.classList.remove('notif-active');
    if (hint) {
      hint.textContent = temPush
        ? 'Avisa quando a sua estação escalar de faixa ou entrar em alarme — mesmo com o app fechado.'
        : 'Sem servidor de avisos configurado: o aviso só chega com o app aberto.';
    }
  }
}

/** Liga/desliga os avisos. */
async function toggleNotifications() {
  const btn = document.getElementById('notification-toggle');
  if (btn) btn.disabled = true;

  try {
    const temPush = isPushSupported() && Boolean(await getPushConfig());

    if (!temPush) {
      // Sem servidor de push: aviso local, e a interface diz isso claramente.
      if (notificationsEnabled()) disableNotifications();
      else await requestNotificationPermission();
      return;
    }

    if (await isSubscribed()) {
      await pushUnsubscribe();
      disableNotifications();
      showToast('Avisos desligados neste aparelho.', { type: 'info' });
      return;
    }

    const res = await pushSubscribe(pushContext());
    if (res.ok) {
      saveToStorage('settings.notifications', true);
      showToast('Pronto: você será avisado mesmo com o app fechado. 🔔', { type: 'success', duration: 6000 });
    } else if (res.reason === 'denied') {
      showToast('Permissão negada. Libere as notificações nas configurações do navegador.', { type: 'warning', duration: 7000 });
    } else if (res.reason === 'sem-suporte') {
      showToast('Este navegador não recebe avisos em segundo plano.', { type: 'warning' });
    } else {
      showToast('Não consegui ligar os avisos agora. Tente de novo mais tarde.', { type: 'error' });
    }
  } finally {
    if (btn) btn.disabled = false;
    await updateNotificationButton();
  }
}

/** Contexto enviado ao servidor de push: estação, bacia e municípios. */
function pushContext() {
  return {
    stationCode: state.level?.station || 'geral',
    basin: state.level?.basin || null,
    places: state.regions.slice(0, 4).map((r) => r.name),
  };
}

// === Inicialização ===
async function init() {
  applyTheme();
  renderThemeIcon();

  // Carrega thresholds/estações de data/ref-levels.json (fonte única)
  await loadConfig();

  // Carrega dados via API (com fallback para sample)
  await loadData();
  renderAll();
  applyEntryAnimations();
  fadeOutLoader();

  renderSafePoint();

  // Minha referência nesta régua
  document.getElementById('my-level-save')?.addEventListener('click', () => {
    const valor = parseFloat(document.getElementById('my-level-input')?.value);
    const rotulo = document.getElementById('my-level-label')?.value.trim() || '';
    if (!state.level || Number.isNaN(valor)) {
      showToast('Informe o nível da régua onde a água chega até você.', { type: 'warning' });
      return;
    }
    setMyLevel(state.level.station, valor, rotulo);
    document.getElementById('my-level-config')?.removeAttribute('open');
    renderMyLevel();
    showToast('Referência salva neste aparelho.', { type: 'success' });
  });

  document.getElementById('my-level-clear')?.addEventListener('click', () => {
    if (!state.level) return;
    setMyLevel(state.level.station, null);
    renderMyLevel();
    showToast('Referência apagada.', { type: 'info' });
  });

  document.getElementById('share-button')?.addEventListener('click', compartilharSituacao);

  // Modo emergência
  document.getElementById('emergency-open')?.addEventListener('click', () => toggleEmergencyScreen(true));
  document.getElementById('emergency-close')?.addEventListener('click', () => toggleEmergencyScreen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('emergency-screen')?.hidden) {
      toggleEmergencyScreen(false);
    }
  });

  // Atalho do manifest (?view=emergencia) abre direto na tela de emergência.
  if (new URLSearchParams(location.search).get('view') === 'emergencia') {
    toggleEmergencyScreen(true);
  }

  // Registra interatividade do gráfico (tooltip, zoom, pan)
  const canvas = document.getElementById('level-canvas');
  if (canvas) {
    attachChartInteractivity(canvas, renderChart, () => state.chartReadings);
  }

  document.getElementById('theme-toggle').addEventListener('click', handleThemeToggle);

  // Fase 6: listener para o limiar de alerta configurável pelo usuário
  const thresholdInput = document.getElementById('alert-threshold-input');
  if (thresholdInput) {
    thresholdInput.value = state.alertThreshold != null ? String(state.alertThreshold) : '';
    thresholdInput.addEventListener('change', (e) => {
      const raw = e.target.value.trim();
      if (raw === '') {
        state.alertThreshold = null;
        saveToStorage('settings.alertThreshold', null);
        showToast('Limiar pessoal removido.', { type: 'info', duration: 3000 });
        return;
      }
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 0) {
        state.alertThreshold = val;
        saveToStorage('settings.alertThreshold', val);
        showToast(`Aviso pessoal ajustado para ${formatMeters(val)}.`, { type: 'success', duration: 3000 });
      } else {
        thresholdInput.value = state.alertThreshold != null ? String(state.alertThreshold) : '';
      }
    });
  }

  // Fase B: listener para o botão de notificações nativas
  updateNotificationButton();
  const notifBtn = document.getElementById('notification-toggle');
  if (notifBtn) notifBtn.addEventListener('click', toggleNotifications);

  // O navegador pode invalidar a inscrição sozinho (sw.js avisa).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (e) => {
      if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        await pushSubscribe(pushContext());
        await updateNotificationButton();
      }
    });
  }

  // Seletor de estação + botão de localização
  const stationSelect = document.getElementById('station-select');
  if (stationSelect) {
    stationSelect.addEventListener('change', (e) => selectStation(e.target.value));
  }
  const locateBtn = document.getElementById('locate-button');
  if (locateBtn) locateBtn.addEventListener('click', useMyLocation);

  // Redesenha o gráfico, matriz e mapa El Niño responsivamente (com debounce)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderChart();
      renderRiskMatrix();
      renderElNino();
    }, 150);
  });

  // Atualização periódica dos dados (5 min)
  setInterval(async () => {
    invalidateCaches(); // sem isso o ciclo releria o JSON cacheado da sessão
    await loadData();
    renderAll();
  }, REFRESH_INTERVAL_MS);
}

init();
