// levels.js — Leituras de nível, histórico e gráfico (Canvas)
// Fase 4: Nível e Gráfico
//
// Responsável por:
//  - Persistir histórico de leituras no localStorage (prefixo gm_)
//  - Deduplicar leituras por estação + minuto
//  - Renderizar gráfico de linha/área em Canvas com linha de transbordo
//
// Nível do Guaíba não tem endpoint JSON público (ver Fase 1). Quando uma
// fonte real for plugada em api.js, os dados fluem para cá sem alterar a UI.

import { saveToStorage, loadFromStorage, formatMeters } from './utils.js';

// Número máximo de leituras por estação no histórico
const MAX_HISTORY_PER_STATION = 50;

// Chave do localStorage (prefixo gm_ vem de utils.js → gm_levels_history)
const HISTORY_STORAGE_KEY = 'levels_history';

/** @returns {LevelReading[]} histórico completo (todas as estações) */
function loadHistory() {
  return loadFromStorage(HISTORY_STORAGE_KEY, []);
}

/**
 * Salva o histórico completo no localStorage.
 * @param {LevelReading[]} history
 */
function saveHistory(history) {
  saveToStorage(HISTORY_STORAGE_KEY, history);
}

/**
 * Extrai o "minuto" de um timestamp ISO — usado para deduplicar leituras
 * que ocorram dentro do mesmo minuto (evita histórico inflado por refresh).
 * @param {string} iso
 */
function minuteKey(iso) {
  // 2026-08-05T14:30:22.123Z → 2026-08-05T14:30
  return iso ? iso.slice(0, 16) : '';
}

/**
 * Adiciona uma leitura ao histórico.
 * - Deduplica por (estação + minuto).
 * - Mantém no máximo MAX_HISTORY_PER_STATION por estação.
 * - Ordena cronologicamente.
 * @param {LevelReading} reading
 * @returns {LevelReading[]} o histórico atualizado
 */
function appendLevelReading(reading) {
  if (!reading || !reading.station || !reading.recordedAt) return loadHistory();

  const history = loadHistory();
  const dedupKey = `${reading.station}|${minuteKey(reading.recordedAt)}`;
  const exists = history.some(h => `${h.station}|${minuteKey(h.recordedAt)}` === dedupKey);

  if (!exists) {
    history.push(reading);
  }

  // Ordena cronologicamente (mais antiga primeiro)
  history.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  // Cap por estação
  const byStation = {};
  history.forEach(h => {
    (byStation[h.station] = byStation[h.station] || []).push(h);
  });
  const capped = [];
  Object.values(byStation).forEach(readings => {
    capped.push(...readings.slice(-MAX_HISTORY_PER_STATION));
  });
  // Re-ordena o resultado final
  capped.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  saveHistory(capped);
  return capped;
}

/**
 * Histórico filtrado e ordenado para uma estação específica.
 * @param {string} stationId
 * @returns {LevelReading[]}
 */
function getLevelHistory(stationId) {
  const history = loadHistory();
  return history
    .filter(h => h.station === stationId)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
}

/**
 * Renderiza um gráfico de linha/área do nível do rio ao longo do tempo.
 * Inclui linha de transbordo (threshold) e rótulos de eixo.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {LevelReading[]} readings — histórico da estação a exibir
 * @param {number} threshold — cota de transbordo em metros
 */
function renderLevelChart(canvas, readings, threshold) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Escala para HiDPI
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = { left: 62, right: 26, top: 26, bottom: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Tema
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = {
    bg: isDark ? '#0a0e17' : '#f8fafc',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    text: isDark ? '#8b919e' : '#64748b',
    water: isDark ? '#0ea5e9' : '#0287ce',
    threshold: isDark ? '#ef4444' : '#dc2626',
    area: isDark ? 'rgba(14,165,233,0.12)' : 'rgba(2,135,206,0.12)',
    axis: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
  };

  // Limpa e pinta fundo
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  // Caso sem histórico
  if (!readings || readings.length === 0) {
    ctx.fillStyle = colors.text;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem histórico de nível ainda.', width / 2, height / 2 - 6);
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.fillText('As leituras aparecem aqui conforme são coletadas.', width / 2, height / 2 + 8);
    return;
  }

  // --- Eixos e escala Y ---
  const values = readings.map(r => r.levelMeters);
  // Garante espaço acima e abaixo, e sempre mostra o threshold
  const rawMin = Math.min(...values, threshold);
  const rawMax = Math.max(...values, threshold);
  const yBot = Math.max(0, Math.floor(rawMin - 0.5));
  const yTop = Math.ceil(rawMax + 0.5);
  const yFinalRange = yTop - yBot;

  /** @param {number} v */
  const yToPixel = (v) => pad.top + plotH - ((v - yBot) / yFinalRange) * plotH;

  // --- Gridlines horizontais + rótulos Y ---
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.text;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'right';
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const val = yBot + (yFinalRange * i / gridSteps);
    const y = yToPixel(val);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(formatMeters(val), pad.left - 8, y + 3);
  }

  // Linha de eixo X
  ctx.strokeStyle = colors.axis;
  ctx.beginPath();
  ctx.moveTo(pad.left, height - pad.bottom);
  ctx.lineTo(pad.left + plotW, height - pad.bottom);
  ctx.stroke();

  // --- Linha de transbordo (threshold) ---
  const thY = yToPixel(threshold);
  ctx.strokeStyle = colors.threshold;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad.left, thY);
  ctx.lineTo(pad.left + plotW, thY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rótulo do threshold
  ctx.fillStyle = colors.threshold;
  ctx.textAlign = 'left';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.fillText(`Transbordo (${formatMeters(threshold)})`, pad.left + 6, thY - 6);

  // --- Área sob a curva ---
  ctx.beginPath();
  ctx.moveTo(pad.left, yToPixel(readings[0].levelMeters));
  for (let i = 0; i < readings.length; i++) {
    const x = pad.left + (readings.length === 1 ? 0 : (i / (readings.length - 1)) * plotW);
    const y = yToPixel(readings[i].levelMeters);
    ctx.lineTo(x, y);
  }
  // Fecha a área na base
  ctx.lineTo(pad.left + plotW, yToPixel(yBot));
  ctx.lineTo(pad.left, yToPixel(yBot));
  ctx.closePath();
  ctx.fillStyle = colors.area;
  ctx.fill();

  // --- Linha principal ---
  ctx.strokeStyle = colors.water;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < readings.length; i++) {
    const x = pad.left + (readings.length === 1 ? 0 : (i / (readings.length - 1)) * plotW);
    const y = yToPixel(readings[i].levelMeters);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // --- Pontos de dados ---
  ctx.fillStyle = colors.water;
  for (let i = 0; i < readings.length; i++) {
    const x = pad.left + (readings.length === 1 ? 0 : (i / (readings.length - 1)) * plotW);
    const y = yToPixel(readings[i].levelMeters);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Rótulos eixo X (tempo) ---
  ctx.fillStyle = colors.text;
  ctx.textAlign = 'center';
  let labelIndices;
  if (readings.length <= 3) {
    labelIndices = [...Array(readings.length).keys()];
  } else {
    labelIndices = [0, Math.floor((readings.length - 1) / 2), readings.length - 1];
  }
  labelIndices.forEach(i => {
    const x = pad.left + (readings.length === 1 ? 0 : (i / (readings.length - 1)) * plotW);
    const time = new Date(readings[i].recordedAt);
    const label = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
    ctx.fillText(label, x, height - pad.bottom + 18);
  });

  // Legenda da unidade no canto inferior direito
  ctx.fillStyle = colors.text;
  ctx.textAlign = 'right';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.fillText('nível (m)', pad.left + plotW, height - 4);
}

export {
  MAX_HISTORY_PER_STATION,
  HISTORY_STORAGE_KEY,
  loadHistory,
  saveHistory,
  appendLevelReading,
  getLevelHistory,
  renderLevelChart,
};
