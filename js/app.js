// app.js — Lógica principal do Guaiba Monitor
// Fase 2: Layout e Dashboard
//
// Importa utilitários de utils.js. Os módulos levels.js, risks.js e alerts.js
// são carregados dinamicamente quando implementados (Fases 4–6).
import { formatMeters, formatDate, saveToStorage, loadFromStorage, generateId } from './utils.js';

// === Dados de exemplo — SIMULAÇÃO/OFFLINE ===
// Fase 1 documentou que não há endpoint JSON público para o nível do Guaíba.
// Estes dados são MARCADADOS como "simulação/offline" e NUNCA apresentados como reais.
// Quando Fase 3 conectar uma fonte JSON real, api.js fornecerá os dados reais.

const THRESHOLDS = {
  atencao: 1.5,
  inundacao: 2.0,
  severa: 2.5,
  critica: 3.0,
  referencia_mai2024: 5.3
};

// Dado de nível atual (simulação)
const SAMPLE_LEVEL = {
  id: generateId(),
  station: 'poa-cais-maua',
  location: 'Porto Alegre',
  levelMeters: 2.13,
  trend: 'subindo',
  recordedAt: new Date().toISOString(),
  source: 'simulação/offline'
};

// Dados de risco por região (simulação)
const SAMPLE_REGIONS = [
  {
    id: 'poa',
    name: 'Porto Alegre',
    levelMeters: 2.13,
    trend: 'subindo',
    note: 'Áreas baixas do centro e zona sul em risco. Evite passar em vias alagadas.'
  },
  {
    id: 'canoas',
    name: 'Canoas',
    levelMeters: 1.82,
    trend: 'estavel',
    note: 'Margens do Guaíba sob vigilância. Monitorar atualizações.'
  },
  {
    id: 'guaiba',
    name: 'Guaíba',
    levelMeters: 1.45,
    trend: 'descendo',
    note: 'Nível estável, abaixo do limite de atenção (1.50 m).'
  }
];

// === Estado da aplicação ===
const state = {
  level: SAMPLE_LEVEL,
  regions: SAMPLE_REGIONS,
  theme: loadFromStorage('settings.theme', 'dark')
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
 * Renderiza os cards de risco por região.
 */
function renderRegions() {
  const grid = document.getElementById('region-grid');
  grid.innerHTML = '';

  state.regions.forEach(region => {
    const status = getLevelStatus(region.levelMeters);
    const trend = getTrendInfo(region.trend);

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

// === Eventos ===
function handleThemeToggle() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  renderThemeIcon();
  saveToStorage('settings.theme', state.theme);
}

// === Inicialização ===
function init() {
  applyTheme();
  renderThemeIcon();
  renderLevelIndicator();
  renderRegions();
  updateTimestamp();
  fadeOutLoader();

  document.getElementById('theme-toggle').addEventListener('click', handleThemeToggle);
}

init();
