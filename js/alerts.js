// alerts.js — Alertas INMET/Defesa Civil + notificações toast
// Fase 6: Alertas e notificações
//
// Camada de apresentação/logic para alertas:
//  - Mapeia severidade → badge/cores/ícones
//  - Ordena e filtra alertas urgentes
//  - Fornece funções puras (testáveis via node --input-type=module)
//  - Cria toasts de notificação quando o nível cruza limiar do usuário
//
// IMPORTANTE: funções puras NÃO usam DOM (document/window). Apenas as
// funções de toast chamam DOM APIs, e elas são invocadas por app.js
// (entry point no browser). O módulo não executa código no import.

import { saveToStorage, loadFromStorage, formatMeters } from './utils.js';

// === Severidade de alertas (esquema do projeto) ===
const ALERT_SEVERITY = {
  info:       { label: 'Info',       css: 'info',       badgeClass: 'badge-info',       icon: 'ℹ️',  color: 'var(--blue)' },
  atencao:    { label: 'Atenção',    css: 'atencao',    badgeClass: 'badge-atencao',    icon: '⚠️',  color: 'var(--yellow)' },
  perigo:     { label: 'Perigo',     css: 'perigo',     badgeClass: 'badge-perigo',     icon: '🔴',  color: 'var(--red)' },
  emergencia: { label: 'Emergência', css: 'emergencia', badgeClass: 'badge-emergencia', icon: '🚨',  color: 'var(--red)' },
};

// Rank para ordenação (maior = mais grave)
const SEVERITY_RANK = { info: 0, atencao: 1, perigo: 2, emergencia: 3 };

// === Thresholds do nível (espelha app.js / data/ref-levels.json) ===
const LEVEL_THRESHOLDS = {
  atencao: 1.5,
  inundacao: 2.0,
  severa: 2.5,
  critica: 3.0,
};

// Ordem de gravidade do nível (índice maior = mais grave)
const LEVEL_RANK_ORDER = ['normal', 'atencao', 'inundacao', 'severa', 'critica'];

// Labels amigáveis para o status do nível
const LEVEL_STATUS_LABELS = {
  normal: 'NORMAL',
  atencao: 'ATENÇÃO',
  inundacao: 'INUNDAÇÃO',
  severa: 'SEVERA',
  critica: 'CRÍTICA',
};

/**
 * Classifica o nível do rio em uma categoria de risco.
 * @param {number} levelMeters — nível em metros
 * @returns {'normal'|'atencao'|'inundacao'|'severa'|'critica'}
 */
function getLevelStatus(levelMeters) {
  const l = parseFloat(levelMeters);
  if (l >= LEVEL_THRESHOLDS.critica) return 'critica';
  if (l >= LEVEL_THRESHOLDS.severa) return 'severa';
  if (l >= LEVEL_THRESHOLDS.inundacao) return 'inundacao';
  if (l >= LEVEL_THRESHOLDS.atencao) return 'atencao';
  return 'normal';
}

/**
 * Formata a severidade de um alerta para exibição.
 * @param {string} severity
 * @returns {{label: string, css: string, badgeClass: string, icon: string, color: string}}
 */
function formatAlertSeverity(severity) {
  return ALERT_SEVERITY[severity] || ALERT_SEVERITY.info;
}

/**
 * Classifica um alerta pelo rank de gravidade (string → número).
 * @param {string} severity
 * @returns {number}
 */
function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * Ordena alertas por gravidade (mais grave primeiro), desempatando por data.
 * @param {Alert[]} alerts
 * @returns {Alert[]} cópia ordenada
 */
function sortAlertsBySeverity(alerts) {
  return [...(alerts || [])].sort((a, b) => {
    const diff = severityRank(b.severity) - severityRank(a.severity);
    if (diff !== 0) return diff;
    return new Date(b.issuedAt || 0) - new Date(a.issuedAt || 0);
  });
}

/**
 * Retorna apenas alertas urgentes (acima de 'info'), ordenados por gravidade.
 * @param {Alert[]} alerts
 * @returns {Alert[]}
 */
function getUrgentAlerts(alerts) {
  return sortAlertsBySeverity(alerts).filter(a => severityRank(a.severity) > 0);
}

/**
 * Formata um alerta bruto para a estrutura de exibição do card.
 * @param {Alert} alert
 * @returns {{id, type, severity, severityInfo, title, message, regions, issuedAt, source, instructions}}
 */
function formatAlertForDisplay(alert) {
  const sev = formatAlertSeverity(alert.severity);
  return {
    id: alert.id || generateAlertId(),
    type: alert.type || 'Alerta',
    severity: alert.severity || 'info',
    severityInfo: sev,
    title: alert.title || alert.type || 'Aviso',
    message: alert.message || '',
    regions: Array.isArray(alert.regions) ? alert.regions : [],
    issuedAt: alert.issuedAt || new Date().toISOString(),
    source: alert.source || 'Desconhecido',
    instructions: Array.isArray(alert.instructions) ? alert.instructions : [],
  };
}

/** Gera um ID único para alertas sem ID */
function generateAlertId() {
  return 'alert-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// === Toast notifications ===

/**
 * Garante que o container de toasts exista no DOM.
 * Cria dinamicamente (appended ao body) se ausente.
 * @returns {HTMLElement}
 */
function ensureToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Mapeia tipo de toast → classes/ícone
 */
const TOAST_TYPES = {
  info:    { class: 'toast--info',    icon: 'ℹ️' },
  warning: { class: 'toast--warning', icon: '⚠️' },
  success: { class: 'toast--success', icon: '✅' },
  error:   { class: 'toast--error',   icon: '❌' },
  danger:  { class: 'toast--danger',  icon: '🚨' },
};

/**
 * Cria e exibe um toast de notificação.
 * @param {string} message — texto do toast
 * @param {object} [options]
 * @param {string} [options.type='info'] — info|warning|success|error|danger
 * @param {number} [options.duration=5000] — ms antes de auto-remover (0 = fixo)
 */
function showToast(message, options = {}) {
  const container = ensureToastContainer();
  const type = TOAST_TYPES[options.type] || TOAST_TYPES.info;
  const duration = options.duration ?? 5000;

  const toast = document.createElement('div');
  toast.className = `toast ${type.class}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  toast.innerHTML = `
    <span class="toast-icon">${type.icon}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" type="button" aria-label="Fechar notificação">&times;</button>
  `;

  // Botão de fechar
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.classList.add('toast--hiding');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  });

  container.appendChild(toast);

  // Força reflow para a animação de entrada
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  // Auto-remover
  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('toast--hiding');
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
      }
    }, duration);
  }

  return toast;
}

/**
 * Verifica se o nível do rio cruzou um limiar em relação à última leitura
 * armazenada e mostra um toast se houve escalada de risco.
 *
 * Usa localStorage (prefixo gm_) para lembrar o status anterior entre recargas:
 *   - gm_levels.last_status  — status (normal/atencao/...) da última leitura
 *   - gm_settings.alertThreshold — limiar personalizado do usuário (metros)
 *
 * @param {LevelReading} levelReading — leitura atual do nível
 * @param {number} [userThreshold] — limiar personalizado (opcional; lê de gm_settings se omitido)
 */
function checkLevelThreshold(levelReading, userThreshold) {
  if (!levelReading || levelReading.levelMeters == null) return;

  const currentStatus = getLevelStatus(levelReading.levelMeters);
  const prevStatus = loadFromStorage('levels.last_status', null);
  const threshold = userThreshold != null
    ? userThreshold
    : loadFromStorage('settings.alertThreshold', LEVEL_THRESHOLDS.atencao);

  const prevRank = prevStatus ? LEVEL_RANK_ORDER.indexOf(prevStatus) : -1;
  const currRank = LEVEL_RANK_ORDER.indexOf(currentStatus);
  const escalated = prevStatus && currRank > prevRank;

  if (escalated) {
    const label = LEVEL_STATUS_LABELS[currentStatus];
    let toastMsg = `Nível do Guaíba ${label}: ${formatMeters(levelReading.levelMeters)} (${levelReading.location}).`;
    if (currentStatus === 'critica') {
      toastMsg += ' Evacuação emergencial nas áreas de risco às margens.';
    } else if (currentStatus === 'severa') {
      toastMsg += ' Inundações avançadas em áreas ribeirinhas.';
    } else {
      toastMsg += ' Monitore atualizações.';
    }
    showToast(toastMsg, { type: 'danger', duration: 8000 });
  }

  // Toast adicional se cruza o limiar personalizado do usuário
  if (threshold && levelReading.levelMeters >= threshold && !escalated) {
    const crossed = !prevStatus || LEVEL_RANK_ORDER.indexOf(getLevelStatus(threshold)) <=
      (prevStatus ? LEVEL_RANK_ORDER.indexOf(prevStatus) : -1);
    // Só mostra se o limiar foi recentemente ultrapassado (status atual >= limiar,
    // mas não era antes) — evita toasts repetidos
    if (crossed || currentStatus !== prevStatus) {
      showToast(
        `Nível atingiu ${formatMeters(levelReading.levelMeters)} — acima do seu limiar de ${formatMeters(threshold)}m (${levelReading.location}).`,
        { type: 'warning', duration: 6000 }
      );
    }
  }

  // Persiste o status atual para a próxima verificação
  saveToStorage('levels.last_status', currentStatus);
}

// === Exports ===
export {
  ALERT_SEVERITY,
  SEVERITY_RANK,
  LEVEL_THRESHOLDS,
  LEVEL_RANK_ORDER,
  LEVEL_STATUS_LABELS,
  getLevelStatus,
  formatAlertSeverity,
  severityRank,
  sortAlertsBySeverity,
  getUrgentAlerts,
  formatAlertForDisplay,
  ensureToastContainer,
  showToast,
  checkLevelThreshold,
};
