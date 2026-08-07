// elnino.js — El Niño / La Niña: dados NOAA, estado ENSO e mapa
//
// Duas responsabilidades:
//  1. FUNÇÕES PURAS (testáveis via node): parse do arquivo NOAA CPC
//     (wksst9120.for) e derivação do estado ENSO a partir da anomalia Nino3.4.
//  2. RENDER (browser/Leaflet): desenha o mapa do Pacífico equatorial com as
//     regiões Niño (1+2, 3, 3.4, 4) coloridas pela anomalia de temperatura.
//
// As funções de render só acessam DOM/Leaflet quando invocadas — o módulo não
// executa nada no import (seguro para testes via node).

// Limiar para estado ENSO (anomalia Nino3.4, °C)
const ENSO_THRESHOLD = 0.5;

// Regiões Niño (polígonos do mapa) e ordem de exibição
const NINO_REGIONS = {
  nino12: { label: 'Niño 1+2', bounds: [[-10, -90], [0, -80]] },
  nino3:  { label: 'Niño 3',   bounds: [[-5, -150], [5, -90]] },
  nino34: { label: 'Niño 3.4', bounds: [[-5, -170], [5, -120]] },
  nino4:  { label: 'Niño 4',   bounds: [[-5, -200], [5, -150]] },
};

const NINO_ORDER = ['nino12', 'nino3', 'nino34', 'nino4'];

/**
 * Divide um token "20.6-0.1" (SST concatenado com SSTA, sem separador)
 * nas partes númericas.
 * @param {string} token
 * @returns {{sst: number, ssta: number}|null}
 */
function splitNumber(token) {
  const m = /^(-?\d+\.\d+)([+-]?\d+\.\d+)$/.exec(token);
  if (!m) return null;
  return { sst: parseFloat(m[1]), ssta: parseFloat(m[2]) };
}

/**
 * Parsea o arquivo semanal da NOAA CPC (wksst9120.for) e retorna a leitura
 * mais recente de cada região Niño.
 * @param {string} text — conteúdo do arquivo
 * @returns {{week: string, regions: {nino12:?,nino3:?,nino34:?,nino4:?}}|null}
 */
function parseNinoText(text) {
  if (!text) return null;
  let last = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 5) continue;
    const week = tokens[0];
    const r = {
      nino12: splitNumber(tokens[1]),
      nino3: splitNumber(tokens[2]),
      nino34: splitNumber(tokens[3]),
      nino4: splitNumber(tokens[4]),
    };
    if (r.nino12 && r.nino3 && r.nino34 && r.nino4) last = { week, regions: r };
  }
  return last;
}

/**
 * Deriva o estado ENSO a partir da anomalia semanal Nino3.4 (°C).
 * @param {number} ssta
 * @returns {'El Niño'|'La Niña'|'Neutro'}
 */
function deriveEnsoState(ssta) {
  if (ssta == null || Number.isNaN(ssta)) return 'Neutro';
  if (ssta >= ENSO_THRESHOLD) return 'El Niño';
  if (ssta <= -ENSO_THRESHOLD) return 'La Niña';
  return 'Neutro';
}

/**
 * Cor de uma anomalia (graus C) em escala azul→vermelho.
 * @param {number} ssta
 * @returns {string} cor hex
 */
function anomalyColor(ssta) {
  const clamped = Math.max(-2, Math.min(2, ssta || 0));
  const t = (clamped + 2) / 4; // 0..1 (frio..quente)
  const cold = [37, 99, 235];   // azul
  const neutral = [234, 179, 8]; // amarelo
  const hot = [220, 38, 38];    // vermelho
  let c;
  if (t < 0.5) {
    c = lerpColor(cold, neutral, t * 2);
  } else {
    c = lerpColor(neutral, hot, (t - 0.5) * 2);
  }
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

// === Render (browser) ===

/**
 * Renderiza o mapa do Pacífico equatorial com as regiões Niño coloridas.
 * @param {HTMLElement|string} container - elemento ou seletor do mapa
 * @param {object} elnino - dados {regions, state, week}
 * @param {boolean} [dark] - tema escuro
 * @returns {object|null} instância do Leaflet mapa
 */
function renderElNinoMap(container, elnino, dark = true) {
  if (typeof L === 'undefined' || !container) return null;
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return null;

  // Destroi instância anterior (evita vazamento no refresh periódico)
  if (el._leafletMap) {
    try { el._leafletMap.remove(); } catch { /* ignorar */ }
  }

  const map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 1, maxZoom: 6 }).setView([-2, -150], 3);

  const tileUrl = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  L.tileLayer(tileUrl, {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 6,
    subdomains: 'abcd',
  }).addTo(map);

  // Linha do equador
  L.polyline([[-5, -220], [-5, -70]], {
    color: '#ffffff33', weight: 1, dashArray: '4 6', interactive: false,
  }).addTo(map);

  const regions = elnino?.regions || {};
  NINO_ORDER.forEach(key => {
    const meta = NINO_REGIONS[key];
    const data = regions[key];
    const ssta = data ? data.ssta : null;
    const color = anomalyColor(ssta);
    const isWarm = ssta != null && ssta > 0;
    const rect = L.rectangle(meta.bounds, {
      color: '#ffffff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.65,
    });
    const sstStr = data ? data.sst.toFixed(1) : '—';
    const sstaStr = ssta != null ? (ssta > 0 ? '+' : '') + ssta.toFixed(2) : '—';
    rect.bindTooltip(
      `<div style="font-size:13px;line-height:1.5">
        <strong style="font-size:14px">${meta.label}</strong><br/>
        <span>SST: <strong>${sstStr}°C</strong></span><br/>
        <span>Anomalia: <strong style="color:${isWarm ? '#ef4444' : '#3b82f6'}">${sstaStr}°C</strong></span>
      </div>`,
      { sticky: true, direction: 'top' }
    );
    rect.addTo(map);

    // Label permanente (tooltip fixo no centro)
    const center = [
      (meta.bounds[0][0] + meta.bounds[1][0]) / 2,
      (meta.bounds[0][1] + meta.bounds[1][1]) / 2,
    ];
    L.marker(center, {
      icon: L.divIcon({
        className: 'nino-region-label',
        html: `<div class="nino-label-inner">${meta.label}<br/><span class="nino-label-ssta">${sstaStr}°</span></div>`,
        iconSize: [80, 40],
        iconAnchor: [40, 20],
      }),
      interactive: false,
    }).addTo(map);
  });

  el._leafletMap = map;
  return map;
}

/**
 * Renderiza o painel de detalhes por região (SST + anomalia + barra visual).
 * @param {HTMLElement|string} container
 * @param {object} elnino
 */
function renderElNinoRegions(container, elnino) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return;

  const regions = elnino?.regions || {};
  const week = elnino?.week || '—';

  const cards = NINO_ORDER.map(key => {
    const meta = NINO_REGIONS[key];
    const data = regions[key];
    const sst = data ? data.sst : null;
    const ssta = data ? data.ssta : null;
    const sstaStr = ssta != null ? (ssta > 0 ? '+' : '') + ssta.toFixed(2) : '—';
    const sstStr = sst != null ? sst.toFixed(1) : '—';
    const barWidth = ssta != null ? Math.min(100, Math.abs(ssta) / 2 * 100) : 0;
    const barColor = anomalyColor(ssta ?? 0);
    const isWarm = ssta != null && ssta > 0;

    return `
      <div class="nino-card">
        <div class="nino-card-header">
          <span class="nino-card-label">${meta.label}</span>
          <span class="nino-card-ssta ${isWarm ? 'warm' : 'cool'}">${sstaStr}°C</span>
        </div>
        <div class="nino-card-sst">SST: ${sstStr}°C</div>
        <div class="nino-card-bar">
          <div class="nino-card-bar-fill" style="width:${barWidth}%;background:${barColor}"></div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="nino-regions-header">
      <span>Semana: <strong>${week}</strong></span>
      <span class="nino-regions-legend">Frio 🔵 ───── 🔴 Quente</span>
    </div>
    <div class="nino-regions-grid">${cards}</div>
  `;
}

/**
 * Renderiza o banner de status ENSO + nota de impacto no Sul.
 * @param {HTMLElement|string} container
 * @param {object} elnino
 */
function renderElNinoStatus(container, elnino) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return;
  const state = elnino?.state || 'Neutro';
  const ssta = elnino?.regions?.nino34?.ssta;
  const css = state === 'El Niño' ? 'atencao' : state === 'La Niña' ? 'inundacao' : 'normal';

  const impact = {
    'El Niño': 'Chuvas acima da média no Sul — risco maior de elevação do Guaíba e enchentes regionais.',
    'La Niña': 'Tendência a estiagem no Sul — menor volume de chuva e nível do rio pode ficar baixo.',
    'Neutro': 'Fase neutra — condições dentro do padrão climático. Sem sinal ENSO dominante.',
  }[state];

  el.innerHTML = `
    <div class="elnino-status badge-${css}">
      <span class="elnino-state">🌡️ ${state}</span>
      <span class="elnino-ssta">Nino3.4: ${ssta != null ? ssta.toFixed(2) : '—'}°C</span>
    </div>
    <p class="elnino-impact">${impact}</p>
  `;
}

export {
  ENSO_THRESHOLD,
  NINO_REGIONS,
  NINO_ORDER,
  splitNumber,
  parseNinoText,
  deriveEnsoState,
  anomalyColor,
  renderElNinoMap,
  renderElNinoRegions,
  renderElNinoStatus,
};
export default {
  parseNinoText,
  deriveEnsoState,
  anomalyColor,
  renderElNinoMap,
  renderElNinoRegions,
  renderElNinoStatus,
};
