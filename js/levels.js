// levels.js — Leituras de nível, histórico e gráfico interativo (Canvas)
// Fase 4: Nível e Gráfico
// Fase B: Gráfico interativo — tooltips, zoom, pan, linha maio/2024
//
// Responsável por:
//  - Persistir histórico de leituras no localStorage (prefixo gm_)
//  - Deduplicar leituras por estação + minuto
//  - Renderizar gráfico de linha/área em Canvas com:
//    * Linha de transbordo (threshold)
//    * Linha de referência maio/2024 (5.30m)
//    * Tooltips ao passar o mouse
//    * Zoom horizontal (scroll) e pan (arrastar)

import { saveToStorage, loadFromStorage, formatMeters } from './utils.js';

// Número máximo de leituras por estação no histórico
const MAX_HISTORY_PER_STATION = 50;

// Chave do localStorage (prefixo gm_ vem de utils.js → gm_levels_history)
const HISTORY_STORAGE_KEY = 'levels_history';

// Cota de maio/2024 (referência histórica do pico do Guaíba)
const MAIO_2024_LEVEL = 5.30;

// Margens do gráfico. Uma constante só: desenho e interação precisam concordar,
// e duplicar esses números fazia o tooltip apontar para o ponto errado.
const PADDING = { left: 62, right: 26, top: 26, bottom: 54 };

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

// === Gráfico interativo ===
// Estado de zoom/pan por canvas (chaveado por ID do canvas)
const chartState = new Map();

// AbortController por canvas: permite re-registrar os listeners sem recriar o
// elemento (e sem perder o que já foi desenhado).
const chartListeners = new Map();

/**
 * Obtém ou cria o estado de zoom/pan para um canvas.
 * @param {string} canvasId
 */
function getChartState(canvasId) {
  if (!chartState.has(canvasId)) {
    chartState.set(canvasId, {
      zoom: 1,        // 1 = sem zoom, >1 = ampliado
      panOffset: 0,   // offset horizontal em pixels
      hoveredIdx: -1,  // índice do ponto sob o mouse (-1 = nenhum)
      mouseX: 0,
      mouseY: 0,
    });
  }
  return chartState.get(canvasId);
}

/**
 * Formata timestamp ISO para rótulo curto do tooltip.
 * @param {string} iso
 * @returns {string} ex: "08/08 18:40"
 */
function tooltipTimeLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * Renderiza um gráfico de linha/área do nível do rio ao longo do tempo.
 * Inclui linha de transbordo (threshold), linha de referência maio/2024,
 * tooltips no hover, zoom (scroll) e pan (arrastar).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {LevelReading[]} readings — histórico da estação a exibir
 * @param {number} threshold — cota de transbordo em metros
 * @param {number} [refLevel] — nível de referência opcional (ex: 5.30m maio/2024)
 */
function renderLevelChart(canvas, readings, threshold, refLevel) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const canvasId = canvas.id || 'level-canvas';
  const cs = getChartState(canvasId);
  // threshold/ref só são desenhados quando pertencem à MESMA régua exibida.
  // Réguas sem cota publicada não recebem linha emprestada de outra estação.
  const hasThreshold = threshold != null && !Number.isNaN(Number(threshold));
  const ref = refLevel != null && !Number.isNaN(Number(refLevel)) ? refLevel : null;

  // Escala para HiDPI
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = PADDING;
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
    ref: isDark ? '#f59e0b' : '#d97706',
    area: isDark ? 'rgba(14,165,233,0.12)' : 'rgba(2,135,206,0.12)',
    axis: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    tooltip: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
    tooltipBorder: isDark ? 'rgba(14,165,233,0.5)' : 'rgba(2,135,206,0.5)',
    tooltipText: isDark ? '#e2e8f0' : '#1e293b',
    hoverPoint: isDark ? '#38bdf8' : '#0ea5e9',
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

  // Aplica zoom: amplia a largura do plot virtual
  const zoomedPlotW = plotW * cs.zoom;
  const virtualW = zoomedPlotW;

  // --- Eixos e escala Y ---
  const values = readings.map(r => r.levelMeters);
  // Garante espaço acima e abaixo, e mostra threshold/ref quando existirem
  const extras = [hasThreshold ? threshold : null, ref].filter((v) => v != null);
  const rawMin = Math.min(...values, ...extras);
  const rawMax = Math.max(...values, ...extras);
  const yBot = Math.max(0, Math.floor(rawMin - 0.5));
  const yTop = Math.ceil(rawMax + 0.5);
  const yFinalRange = yTop - yBot;

  /** @param {number} v */
  const yToPixel = (v) => pad.top + plotH - ((v - yBot) / yFinalRange) * plotH;

  // --- Mapeamento X com zoom/pan ---
  const totalReadings = readings.length;
  const xToPixel = (i) => {
    const frac = totalReadings === 1 ? 0.5 : i / (totalReadings - 1);
    return pad.left + frac * virtualW + cs.panOffset;
  };

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

  // --- Linha de transbordo (threshold da própria régua) ---
  if (hasThreshold) {
    const thY = yToPixel(threshold);
    ctx.strokeStyle = colors.threshold;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad.left, thY);
    ctx.lineTo(pad.left + plotW, thY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = colors.threshold;
    ctx.textAlign = 'left';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Transbordo (${formatMeters(threshold)})`, pad.left + 6, thY - 6);
  }

  // --- Linha de referência maio/2024 (só na régua a que ela pertence) ---
  if (ref != null) {
    const refY = yToPixel(ref);
    ctx.strokeStyle = colors.ref;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, refY);
    ctx.lineTo(pad.left + plotW, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = colors.ref;
    ctx.textAlign = 'right';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Maio/2024 (${ref.toFixed(2)} m)`, pad.left + plotW - 6, refY - 5);
  }

  // --- Área sob a curva ---
  ctx.beginPath();
  ctx.moveTo(xToPixel(0), yToPixel(readings[0].levelMeters));
  for (let i = 0; i < readings.length; i++) {
    const x = xToPixel(i);
    const y = yToPixel(readings[i].levelMeters);
    ctx.lineTo(x, y);
  }
  // Fecha a área na base
  ctx.lineTo(xToPixel(readings.length - 1), yToPixel(yBot));
  ctx.lineTo(xToPixel(0), yToPixel(yBot));
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
    const x = xToPixel(i);
    const y = yToPixel(readings[i].levelMeters);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // --- Pontos de dados ---
  ctx.fillStyle = colors.water;
  for (let i = 0; i < readings.length; i++) {
    const x = xToPixel(i);
    const y = yToPixel(readings[i].levelMeters);
    // Só desenha pontos visíveis (dentro da área do plot)
    if (x >= pad.left && x <= pad.left + plotW) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
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
    const x = xToPixel(i);
    if (x >= pad.left && x <= pad.left + plotW) {
      const time = new Date(readings[i].recordedAt);
      const label = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(label, x, height - pad.bottom + 18);
    }
  });

  // Legenda da unidade no canto inferior direito
  ctx.fillStyle = colors.text;
  ctx.textAlign = 'right';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.fillText('nível (m)', pad.left + plotW, height - 4);

  // --- Tooltip no hover ---
  if (cs.hoveredIdx >= 0 && cs.hoveredIdx < readings.length) {
    const r = readings[cs.hoveredIdx];
    const px = xToPixel(cs.hoveredIdx);
    const py = yToPixel(r.levelMeters);

    // Linha vertical de destaque
    ctx.strokeStyle = colors.hoverPoint;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, height - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ponto destacado
    ctx.fillStyle = colors.hoverPoint;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();

    // Caixa do tooltip
    const lines = [
      `${formatMeters(r.levelMeters)}`,
      tooltipTimeLabel(r.recordedAt),
    ];
    if (r.trend) {
      const trendLabel = typeof r.trend === 'string' ? r.trend : '';
      if (trendLabel) lines.push(trendLabel);
    }

    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    const lineHeight = 16;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
    const th = lines.length * lineHeight + 10;
    // Posiciona à direita do ponto, ou à esquerda se não couber
    let tx = px + 10;
    if (tx + tw > pad.left + plotW) tx = px - tw - 10;
    let ty = py - th - 5;
    if (ty < pad.top) ty = py + 10;

    // Fundo do tooltip
    ctx.fillStyle = colors.tooltip;
    ctx.strokeStyle = colors.tooltipBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, tx, ty, tw, th, 6);
    ctx.fill();
    ctx.stroke();

    // Texto do tooltip
    ctx.fillStyle = colors.tooltipText;
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillText(line, tx + 10, ty + 14 + i * lineHeight);
    });
  }
}

/**
 * Desenha um retângulo com cantos arredondados.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Registra os event listeners para interatividade do gráfico (zoom, pan, tooltip).
 * Deve ser chamado uma vez após renderLevelChart.
 * @param {HTMLCanvasElement} canvas
 * @param {function} onRerender — callback para re-renderizar (ex: renderChart do app.js)
 * @param {function} getReadings — retorna o array de leituras atual do app
 */
function attachChartInteractivity(canvas, onRerender, getReadings) {
  const canvasId = canvas.id || 'level-canvas';
  const cs = getChartState(canvasId);

  // Remove listeners de uma chamada anterior sem trocar o elemento.
  // (Clonar o canvas apagava o gráfico recém-desenhado: no desktop o primeiro
  // movimento do mouse redesenhava e escondia o problema, mas no celular —
  // onde não há mousemove — o gráfico ficava em branco para sempre.)
  const previous = chartListeners.get(canvasId);
  if (previous) previous.abort();
  const controller = new AbortController();
  chartListeners.set(canvasId, controller);
  const on = (target, type, handler, opts) =>
    target.addEventListener(type, handler, { ...(opts || {}), signal: controller.signal });

  // Redesenhar a cada evento de movimento derruba o desempenho no celular:
  // um pedido de quadro por vez basta, e o resultado é o mesmo na tela.
  let quadroPedido = false;
  const redesenhar = () => {
    if (quadroPedido) return;
    quadroPedido = true;
    requestAnimationFrame(() => {
      quadroPedido = false;
      onRerender();
    });
  };

  /** Ponto mais próximo do X informado (em px do canvas). */
  const pontoMaisProximo = (x, largura) => {
    const readings = getReadings();
    if (!readings || readings.length === 0) return -1;
    const plotW = largura - PADDING.left - PADDING.right;
    const zoomedPlotW = plotW * cs.zoom;
    let melhor = -1;
    let menorDist = Infinity;
    for (let i = 0; i < readings.length; i++) {
      const frac = readings.length === 1 ? 0.5 : i / (readings.length - 1);
      const px = PADDING.left + frac * zoomedPlotW + cs.panOffset;
      const dist = Math.abs(x - px);
      if (dist < menorDist) { menorDist = dist; melhor = i; }
    }
    return { indice: melhor, distancia: menorDist };
  };

  /** Coordenadas do evento relativas ao canvas. */
  const posicao = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  };

  // === Ponteiro: serve para mouse, toque e caneta ===

  const ponteiros = new Map();
  let arrastando = false;
  let arrasteInicioX = 0;
  let panInicial = 0;
  let distanciaInicial = 0;
  let zoomInicial = 1;

  on(canvas, 'pointerdown', (e) => {
    ponteiros.set(e.pointerId, e);
    canvas.setPointerCapture?.(e.pointerId);

    if (ponteiros.size === 2) {
      // Dois dedos: pinça para zoom.
      const [a, b] = [...ponteiros.values()];
      distanciaInicial = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      zoomInicial = cs.zoom;
      arrastando = false;
      return;
    }

    arrastando = true;
    arrasteInicioX = e.clientX;
    panInicial = cs.panOffset;

    // No toque, encostar já mostra o valor daquele ponto.
    if (e.pointerType !== 'mouse') {
      const { x, rect } = posicao(e);
      const alvo = pontoMaisProximo(x, rect.width);
      cs.hoveredIdx = alvo && alvo.distancia < 44 ? alvo.indice : -1;
      redesenhar();
    }
  });

  on(canvas, 'pointermove', (e) => {
    if (ponteiros.has(e.pointerId)) ponteiros.set(e.pointerId, e);

    if (ponteiros.size === 2 && distanciaInicial > 0) {
      const [a, b] = [...ponteiros.values()];
      const distancia = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      cs.zoom = Math.max(1, Math.min(zoomInicial * (distancia / distanciaInicial), 10));
      redesenhar();
      return;
    }

    const { x, y, rect } = posicao(e);

    if (arrastando) {
      cs.panOffset = panInicial + (e.clientX - arrasteInicioX);
      // Arrastar com o dedo move o gráfico, não a página.
      if (e.pointerType !== 'mouse') e.preventDefault();
      redesenhar();
      return;
    }

    if (e.pointerType !== 'mouse') return;

    const plotW = rect.width - PADDING.left - PADDING.right;
    const dentro = x >= PADDING.left && x <= PADDING.left + plotW &&
      y >= PADDING.top && y <= rect.height - PADDING.bottom;
    const alvo = dentro ? pontoMaisProximo(x, rect.width) : null;
    cs.hoveredIdx = alvo && alvo.distancia < 30 ? alvo.indice : -1;
    redesenhar();
  }, { passive: false });

  const soltar = (e) => {
    ponteiros.delete(e.pointerId);
    if (ponteiros.size < 2) distanciaInicial = 0;
    if (ponteiros.size === 0) arrastando = false;
  };
  on(canvas, 'pointerup', soltar);
  on(canvas, 'pointercancel', soltar);
  on(window, 'pointerup', () => { arrastando = false; });

  on(canvas, 'pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    cs.hoveredIdx = -1;
    redesenhar();
  });

  // === Scroll: zoom no desktop ===
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = cs.zoom;
    const newZoom = Math.max(1, Math.min(oldZoom * delta, 10));
    if (newZoom !== oldZoom) {
      // Ajusta o pan ANTES de trocar o zoom — usando a razão nova/antiga, que
      // com a ordem anterior era sempre 1 (o zoom já havia sido sobrescrito).
      cs.panOffset = cs.panOffset * (newZoom / oldZoom);
      cs.zoom = newZoom;
      redesenhar();
    }
  }, { passive: false });

  // === Duplo toque/clique: volta ao início ===
  on(canvas, 'dblclick', () => {
    cs.zoom = 1;
    cs.panOffset = 0;
    cs.hoveredIdx = -1;
    redesenhar();
  });

  let ultimoToque = 0;
  on(canvas, 'pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    const agora = Date.now();
    if (agora - ultimoToque < 300) {
      cs.zoom = 1;
      cs.panOffset = 0;
      cs.hoveredIdx = -1;
      redesenhar();
    }
    ultimoToque = agora;
  });

  // === Teclado: o gráfico também precisa ser navegável sem ponteiro ===
  canvas.tabIndex = 0;
  on(canvas, 'keydown', (e) => {
    const readings = getReadings() || [];
    if (readings.length === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const passo = e.key === 'ArrowRight' ? 1 : -1;
      const atual = cs.hoveredIdx < 0 ? (passo > 0 ? -1 : readings.length) : cs.hoveredIdx;
      cs.hoveredIdx = Math.max(0, Math.min(readings.length - 1, atual + passo));
      anunciarLeitura(readings[cs.hoveredIdx]);
      redesenhar();
    } else if (e.key === 'Escape') {
      cs.hoveredIdx = -1;
      cs.zoom = 1;
      cs.panOffset = 0;
      redesenhar();
    }
  });

  // Garante que o gráfico esteja desenhado depois de registrar a interação.
  onRerender();
}

/**
 * Anuncia a leitura destacada para leitores de tela — o canvas não tem
 * conteúdo que o TalkBack consiga ler sozinho.
 * @param {object} reading
 */
function anunciarLeitura(reading) {
  const el = document.getElementById('chart-announcer');
  if (!el || !reading) return;
  el.textContent = `${formatMeters(reading.levelMeters)} em ${tooltipTimeLabel(reading.recordedAt)}`;
}

export {
  MAX_HISTORY_PER_STATION,
  HISTORY_STORAGE_KEY,
  MAIO_2024_LEVEL,
  loadHistory,
  saveHistory,
  appendLevelReading,
  getLevelHistory,
  renderLevelChart,
  attachChartInteractivity,
};
