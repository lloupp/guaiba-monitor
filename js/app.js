// app.js — Lógica principal do Guaiba Monitor
// Fase 2 + Fase 3 + Fase 5 + Fase 6: Layout/Dashboard + Coleta + Riscos + Alertas
//
// app.js é o entry point único (index.html carrega apenas este módulo).
// Importa utils.js, api.js, levels.js, risks.js e alerts.js via import.
import { formatMeters, formatDate, saveToStorage, loadFromStorage, escapeHtml } from './utils.js';
import { fetchAll, sampleLevels, sampleAlerts } from './api.js';
import { appendLevelReading, getLevelHistory, renderLevelChart } from './levels.js';
import { THRESHOLDS, loadConfig } from './config.js';
import {
  DISASTER_TYPES,
  DISASTER_ORDER,
  buildRegionRisks,
  sampleRegionRisks,
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
  getLevelStatusInfo,
} from './alerts.js';

// === Dados de exemplo — SIMULAÇÃO/OFFLINE ===
// Fase 1 documentou que não há endpoint JSON público para o nível do Guaíba.
// Estes dados são MARCADADOS como "simulação/offline" e NUNCA apresentados como reais.
// Quando api.js conecta uma fonte real, ela fornece os dados reais.

// Intervalo de atualização automática dos dados (5 minutos)
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// === Estado da aplicação ===
const state = {
  level: null,
  regions: [],
  alerts: [],
  weather: [],
  riskMatrix: [],
  alertThreshold: loadFromStorage('settings.alertThreshold', THRESHOLDS.atencao),
  dataSources: {
    level: 'simulação/offline',
    alerts: 'simulação/offline',
    weather: 'simulação/offline',
    risks: 'simulação/offline',
  },
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
 * Gera orientação por região baseada no nível.
 */
function getRegionNote(levelMeters, location) {
  const l = parseFloat(levelMeters);
  if (l >= THRESHOLDS.critica) return `Nível CRÍTICO em ${location}. Evacuação emergencial imediata. Afastar-se de margens e vias alagadas.`;
  if (l >= THRESHOLDS.severa)  return `${location} em nível severo (${formatMeters(levelMeters)}). Risco de inundações avançadas. Redobre atenção.`;
  if (l >= THRESHOLDS.inundacao) return `${location} acima da cota de inundação (${formatMeters(levelMeters)}). Áreas baixas em risco. Monitore atualizações.`;
  if (l >= THRESHOLDS.atencao) return `${location} no limite de atenção (${formatMeters(levelMeters)}). Vigiar evolução.`;
  return `${location} com nível normal (${formatMeters(levelMeters)}). Monitorar periodicamente.`;
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
    note: getRegionNote(levelReading.levelMeters, levelReading.location),
    source: levelReading.source
  };
}

// === Carregamento de dados ===

/**
 * Carrega todos os dados via api.js.
 * Usa fallback (sample) quando APIs não respondem.
 * Atualiza o state e re-renderiza.
 */
async function loadData() {
  try {
    const data = await fetchAll();

    // Nível do Guaíba (sempre simulação para MVP, mas arquitetura pronta)
    const stations = data.level.stations || sampleLevels();
    state.dataSources.level = data.level.source;
    // O nível atual mostra a estação principal (POA Cais Mauá)
    const mainStation = stations.find(s => s.station === 'poa-cais-maua') || stations[0];
    state.level = mainStation;

    // Regiões: converte todas as estações para cards de região
    state.regions = stations.map(levelToRegion);

    // Alertas: INMET + DCRS reais, com fallback sample
    if (data.alerts.length > 0) {
      state.alerts = data.alerts;
      state.dataSources.alerts = data.alerts.every(a => a.source === 'simulação/offline')
        ? 'simulação/offline'
        : data.alerts.find(a => a.source !== 'simulação/offline')?.source || 'simulação/offline';
    } else {
      state.alerts = sampleAlerts();
      state.dataSources.alerts = 'simulação/offline (fallback — sem alertas reais)';
    }

    // Clima
    state.weather = data.weather || [];
    state.dataSources.weather = state.weather.length > 0
      ? (state.weather.every(w => w.source === 'simulação/offline') ? 'simulação/offline' : 'INMET')
      : 'simulação/offline';

    // === Fase 5: Matriz de riscos (região × tipo de desastre) ===
    state.riskMatrix = buildRegionRisks(
      state.regions, state.alerts, state.weather, state.level, state.dataSources
    );
    state.dataSources.risks = state.riskMatrix.every(r => r.source === 'simulação/offline')
      ? 'simulação/offline'
      : 'derivado (nível + INMET)';

    // Salva no localStorage (com prefixo gm_)
    saveToStorage('levels', stations);
    saveToStorage('alerts', state.alerts);
    saveToStorage('weather', state.weather);
    saveToStorage('data_sources', state.dataSources);

  } catch (err) {
    console.error('[app] Erro ao carregar dados — usando fallback:', err.message);
    state.dataSources.level = 'simulação/offline (erro coleta)';
    state.dataSources.alerts = 'simulação/offline (erro coleta)';
    state.dataSources.weather = 'simulação/offline (erro coleta)';
    const fallback = sampleLevels();
    state.level = fallback.find(s => s.station === 'poa-cais-maua') || fallback[0];
    state.regions = fallback.map(levelToRegion);
    state.alerts = sampleAlerts();
    // === Fase 5: Matriz de riscos (simulação/offline) ===
    state.riskMatrix = sampleRegionRisks();
    state.dataSources.risks = 'simulação/offline';
  } finally {
    state.loading = false;
    state.lastFetch = new Date();
    // Registra a leitura atual no histórico (para o gráfico da Fase 4)
    if (state.level) {
      appendLevelReading(state.level);
      // Fase 6: verifica limiar e mostra toast se houver escalada de risco
      checkLevelThreshold(state.level, state.alertThreshold);
    }
    // Persiste alertas no localStorage (prefixo gm_)
    saveToStorage('alerts', state.alerts);
  }
}

// === Renderização ===

/**
 * Renderiza o indicador de nível atual no header.
 */
function renderLevelIndicator() {
  const level = state.level;
  const status = getLevelStatusInfo(level.levelMeters);
  const trend = getTrendInfo(level.trend);

  const badge = document.getElementById('level-badge');
  badge.textContent = status.label;
  badge.className = `level-badge badge-${status.css}`;

  const source = document.getElementById('level-source');
  source.textContent = level.source;

  const meters = document.getElementById('level-meters');
  meters.textContent = level.levelMeters.toFixed(2);

  const cota = document.getElementById('cota-transbordo');
  cota.textContent = `${THRESHOLDS.inundacao.toFixed(2)} m`;

  const trendEl = document.getElementById('level-trend');
  trendEl.innerHTML = `<span class="trend-icon">${trend.icon}</span><span>${trend.text} ${relativeTime(level.recordedAt)}</span>`;
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
 * Usa o histórico persistido em localStorage (localStorage gm_levels_history).
 */
function renderChart() {
  const canvas = document.getElementById('level-canvas');
  if (!canvas) return;

  const history = getLevelHistory(state.level.station);
  const threshold = THRESHOLDS.inundacao;

  renderLevelChart(canvas, history, threshold);

  // Atualiza metadados abaixo do gráfico
  const countEl = document.getElementById('graph-count');
  const sourceEl = document.getElementById('graph-source');
  if (countEl) {
    countEl.textContent = history.length > 0
      ? `${history.length} leitura(s) — última: ${formatDate(history[history.length - 1].recordedAt)}`
      : 'Sem histórico';
  }
  if (sourceEl) {
    sourceEl.textContent = state.dataSources.level;
  }
}

/**
 * Renderiza os cards de risco por região.
 * Fase 5: integra a matriz de riscos (região × desastre) — adiciona
 * um badge de risco geral derivado da matriz ao lado do nível.
 */
function renderRegions() {
  const grid = document.getElementById('region-grid');
  grid.innerHTML = '';

  state.regions.forEach(region => {
    const status = getLevelStatusInfo(region.levelMeters);
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
        <span class="region-risk badge-${status.css}">${status.label}</span>
      </div>
      <div class="region-level">${formatMeters(region.levelMeters)}</div>
      <div class="region-trend">
        <span class="trend-icon">${trend.icon}</span>
        <span>${trend.text}</span>
      </div>
      <div class="region-risk-summary">
        <span class="region-risk-label">Risco geral:</span>
        ${overallFmt ? `<span class="region-risk-badge badge-${overallFmt.badgeClass}">${overallFmt.icon} ${overallFmt.label}</span><span class="region-risk-cause">(${escapeHtml(riskCause)})</span>` : '<span class="region-risk-badge badge-normal">🟢 Normal</span>'}
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
  const sources = Object.entries(state.dataSources)
    .filter(([_, v]) => v && !v.includes('erro'))
    .map(([k, v]) => `${k}: ${v}`);
  document.getElementById('data-source').textContent = sources.join(' | ') || 'dados simulados (simulação/offline) para MVP';
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
 * Indica se um alerta é simulado/offline (não é um alerta oficial ativo).
 * @param {{source?: string}} alert
 * @returns {boolean}
 */
function isSimulated(alert) {
  const s = String(alert?.source || '').toLowerCase();
  return s.includes('simulação') || s.includes('offline') || s.includes('fallback');
}

/**
 * Renderiza a lista de alertas ativos.
 * Fase 6: ordena por gravidade (mais grave primeiro), exibe como cards
 * coloridos com badge de severidade. Mostra estado vazio quando não há alertas.
 */
function renderAlerts() {
  const listEl = document.getElementById('alerts-list');
  const emptyEl = document.getElementById('alerts-empty');
  if (!listEl || !emptyEl) return;

  const sorted = sortAlertsBySeverity(state.alerts);
  const real = sorted.filter(a => !isSimulated(a));
  const simulated = sorted.filter(a => isSimulated(a));

  listEl.innerHTML = '';

  if (sorted.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  listEl.style.display = 'flex';
  emptyEl.style.display = 'none';

  const appendCard = (alert, isFake) => {
    const display = formatAlertForDisplay(alert);
    const sev = display.severityInfo;
    const regionsText = display.regions.length > 0
      ? display.regions.join(', ')
      : 'Todas as regiões';

    const instructionsHtml = display.instructions && display.instructions.length > 0
      ? `
        <div class="alert-card-instructions">
          <strong>Orientações:</strong>
          <ul>${display.instructions.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>
      `
      : '';

    const card = document.createElement('div');
    card.className = `alert-card alert-card--${sev.css}${isFake ? ' alert-card--simulated' : ''}`;
    card.setAttribute('data-alert-id', display.id);

    const simBadge = isFake
      ? '<span class="alert-sim-badge" title="Dados de exemplo — não são alertas oficiais ativos">📊 simulação</span>'
      : '';

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
      ${simBadge}
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

    listEl.appendChild(card);
  };

  // Alertas reais primeiro, simulados depois (sempre marcados)
  real.forEach(a => appendCard(a, false));
  if (simulated.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'alerts-divider';
    divider.textContent = `⬇ ${simulated.length} alerta(s) de exemplo (simulação/offline)`;
    listEl.appendChild(divider);
    simulated.forEach(a => appendCard(a, true));
  }
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

// === Eventos ===
function handleThemeToggle() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  renderThemeIcon();
  saveToStorage('settings.theme', state.theme);
  // Re-renderiza o gráfico com as cores do novo tema
  renderChart();
}

// === Renderização conjunta (usada no init e no refresh automático) ===
function renderAll() {
  renderLevelIndicator();
  renderChart();
  renderRegions();
  renderRiskMatrix();
  renderAlerts();
  renderPreparationChecklist();
  updateTimestamp();
  updateDataSource();
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

  document.getElementById('theme-toggle').addEventListener('click', handleThemeToggle);

  // Fase 6: listener para o limiar de alerta configurável pelo usuário
  const thresholdInput = document.getElementById('alert-threshold-input');
  if (thresholdInput) {
    thresholdInput.value = String(state.alertThreshold);
    thresholdInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 0) {
        state.alertThreshold = val;
        saveToStorage('settings.alertThreshold', val);
        showToast(`Limiar de alerta ajustado para ${formatMeters(val)}.`, { type: 'success', duration: 3000 });
      } else {
        thresholdInput.value = String(state.alertThreshold);
      }
    });
  }

  // Redesenha o gráfico e matriz responsivamente
  window.addEventListener('resize', () => {
    renderChart();
    renderRiskMatrix();
  });

  // Atualização periódica dos dados (5 min)
  setInterval(async () => {
    await loadData();
    renderAll();
  }, REFRESH_INTERVAL_MS);
}

init();
