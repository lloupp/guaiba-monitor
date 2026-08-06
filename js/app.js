// app.js — Lógica principal do Guaiba Monitor
// Fase 2 + Fase 3: Layout e Dashboard + Coleta de dados
//
// app.js é o entry point único (index.html carrega apenas este módulo).
// Importa utils.js e api.js via import.
import { formatMeters, formatDate, saveToStorage, loadFromStorage, generateId } from './utils.js';
import { fetchAll, sampleLevels, sampleAlerts } from './api.js';
import { appendLevelReading, getLevelHistory, renderLevelChart } from './levels.js';
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

// === Dados de exemplo — SIMULAÇÃO/OFFLINE ===
// Fase 1 documentou que não há endpoint JSON público para o nível do Guaíba.
// Estes dados são MARCADADOS como "simulação/offline" e NUNCA apresentados como reais.
// Quando api.js conecta uma fonte real, ela fornece os dados reais.

const THRESHOLDS = {
  atencao: 1.5,
  inundacao: 2.0,
  severa: 2.5,
  critica: 3.0,
  referencia_mai2024: 5.3
};

// === Estado da aplicação ===
const state = {
  level: null,
  regions: [],
  alerts: [],
  weather: [],
  riskMatrix: [],
  dataSources: {
    level: 'simulação/offline',
    alerts: 'simulação/offline',
    weather: 'simulação/offline',
    risks: 'simulação/offline',
  },
  theme: loadFromStorage('settings.theme', 'dark'),
  loading: true
};

// === Funções de classificação ===

/**
 * Classifica o nível do rio em categorias de risco.
 * @param {number} levelMeters — nível em metros
 * @returns {{label: string, css: string}}
 */
function getLevelStatus(levelMeters) {
  const l = parseFloat(levelMeters);
  if (l >= THRESHOLDS.critica) return { label: 'CRÍTICA', css: 'critica' };
  if (l >= THRESHOLDS.severa)  return { label: 'SEVERA',   css: 'severa' };
  if (l >= THRESHOLDS.inundacao) return { label: 'INUNDAÇÃO', css: 'inundacao' };
  if (l >= THRESHOLDS.atencao) return { label: 'ATENÇÃO',   css: 'atencao' };
  return { label: 'NORMAL',    css: 'normal' };
}

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
  if (l >= THRESHOLDS.severa)  return `${location} em nível severo (${levelMeters.toFixed(2)} m). Risco de inundações avançadas. Redobre atenção.`;
  if (l >= THRESHOLDS.inundacao) return `${location} acima da cota de inundação (${levelMeters.toFixed(2)} m). Áreas baixas em risco. Monitore atualizações.`;
  if (l >= THRESHOLDS.atencao) return `${location} no limite de atenção (${levelMeters.toFixed(2)} m). Vigiar evolução.`;
  return `${location} com nível normal (${levelMeters.toFixed(2)} m). Monitorar periodicamente.`;
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
    // Registra a leitura atual no histórico (para o gráfico da Fase 4)
    if (state.level) {
      appendLevelReading(state.level);
    }
  }
}

// === Renderização ===

/**
 * Renderiza o indicador de nível atual no header.
 */
function renderLevelIndicator() {
  const level = state.level;
  const status = getLevelStatus(level.levelMeters);
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
  trendEl.innerHTML = `<span class="trend-icon">${trend.icon}</span><span>${trend.text} há 2h</span>`;
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
    const status = getLevelStatus(region.levelMeters);
    const trend = getTrendInfo(region.trend);
    const overall = getRegionOverallRisk(state.riskMatrix, region.name);
    const overallBadge = overall
      ? `<span class="region-risk-badge badge-${formatRiskLevel(overall.riskLevel).badgeClass}">${formatRiskLevel(overall.riskLevel).icon} ${formatRiskLevel(overall.riskLevel).label}</span>`
      : '';

    const card = document.createElement('div');
    card.className = 'region-card';
    card.dataset.region = region.id;
    card.innerHTML = `
      <div class="region-header">
        <span class="region-name">${region.name}</span>
        <span class="region-risk badge-${status.css}">${status.label}</span>
      </div>
      <div class="region-level">${formatMeters(region.levelMeters)}</div>
      <div class="region-trend">
        <span class="trend-icon">${trend.icon}</span>
        <span>${trend.text}</span>
      </div>
      <div class="region-risk-summary">
        <span class="region-risk-label">Risco geral:</span>
        ${overallBadge || '<span class="region-risk-badge badge-normal">🟢 Normal</span>'}
        ${overall ? `<span class="region-risk-cause">(${DISASTER_TYPES[overall.disasterType]?.label || overall.disasterType})</span>` : ''}
      </div>
      <p class="region-note">${region.note}</p>
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
 */
function updateTimestamp() {
  const now = new Date();
  document.getElementById('last-update').textContent = formatDate(now.toISOString());
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
 */
function renderRiskMatrix() {
  const container = document.getElementById('risk-matrix');
  if (!container) return;

  // Determina regiões únicas (mantém ordem de state.regions)
  const regionNames = state.regions.map(r => r.name);

  // === Tabela da matriz ===
  const table = document.createElement('table');
  table.className = 'risk-table';
  table.innerHTML = '';

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Região</th>
      ${DISASTER_ORDER.map(key => `<th>${DISASTER_TYPES[key].icon} ${DISASTER_TYPES[key].label}</th>`).join('')}
    </tr>
  `;
  table.appendChild(thead);

  // Body — uma linha por região
  const tbody = document.createElement('tbody');
  regionNames.forEach(regionName => {
    const risks = getRisksByRegion(state.riskMatrix, regionName);
    const row = document.createElement('tr');
    row.innerHTML = `<td class="risk-region-cell">${regionName}</td>`;

    DISASTER_ORDER.forEach(disasterKey => {
      const risk = risks.find(r => r.disasterType === disasterKey);
      if (!risk) {
        row.innerHTML += `<td class="risk-blank">—</td>`;
      } else {
        const fmt = formatRiskLevel(risk.riskLevel);
        row.innerHTML += `
          <td class="risk-cell" data-risk="${fmt.css}">
            <span class="risk-badge badge-${fmt.badgeClass}">${fmt.label}</span>
          </td>
        `;
      }
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
    const block = document.createElement('div');
    block.className = 'orientation-block';
    const overallFmt = overall ? formatRiskLevel(overall.riskLevel) : formatRiskLevel('baixo');
    block.innerHTML = `
      <div class="orientation-header">
        <span class="orientation-region">${regionName}</span>
        <span class="orientation-badge badge-${overallFmt.badgeClass}">${overallFmt.icon} ${overallFmt.label}</span>
      </div>
      <div class="orientation-content">
        ${risks
          .filter(r => riskRank(r.riskLevel) > 0)  // só riscos acima de "baixo"
          .sort((a, b) => riskRank(b.riskLevel) - riskRank(a.riskLevel))
          .map(r => {
            const fmt = formatRiskLevel(r.riskLevel);
            return `
              <div class="orientation-item">
                <span class="orientation-disaster">${DISASTER_TYPES[r.disasterType]?.icon || '⚠️'} ${DISASTER_TYPES[r.disasterType]?.label || r.disasterType}</span>
                <span class="orientation-text">${getOrientation(r.disasterType, r.riskLevel)}</span>
              </div>
            `;
          }).join('')}
      </div>
    `;
    orientationEl.appendChild(block);
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

// === Inicialização ===
async function init() {
  applyTheme();
  renderThemeIcon();

  // Carrega dados via API (com fallback para sample)
  await loadData();

  renderLevelIndicator();
  renderChart();
  renderRegions();
  renderRiskMatrix();
  updateTimestamp();
  updateDataSource();
  fadeOutLoader();

  document.getElementById('theme-toggle').addEventListener('click', handleThemeToggle);

  // Redesenha o gráfico e matriz responsivamente
  window.addEventListener('resize', () => {
    renderChart();
    renderRiskMatrix();
  });
}

init();
