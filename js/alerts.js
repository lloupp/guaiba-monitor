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
import { THRESHOLDS } from './config.js';

// === Severidade de alertas (esquema do projeto) ===
const ALERT_SEVERITY = {
  info:       { label: 'Info',       css: 'info',       badgeClass: 'badge-info',       icon: 'ℹ️',  color: 'var(--blue)' },
  atencao:    { label: 'Atenção',    css: 'atencao',    badgeClass: 'badge-atencao',    icon: '⚠️',  color: 'var(--yellow)' },
  perigo:     { label: 'Perigo',     css: 'perigo',     badgeClass: 'badge-perigo',     icon: '🔴',  color: 'var(--red)' },
  emergencia: { label: 'Emergência', css: 'emergencia', badgeClass: 'badge-emergencia', icon: '🚨',  color: 'var(--red)' },
};

// Rank para ordenação (maior = mais grave)
const SEVERITY_RANK = { info: 0, atencao: 1, perigo: 2, emergencia: 3 };

// Thresholds do nível (fonte única: config.js ← data/ref-levels.json)
const LEVEL_THRESHOLDS = THRESHOLDS;

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

// Classe de badge CSS por status (a mesma chave do status)
const LEVEL_STATUS_CSS = {
  normal: 'normal',
  atencao: 'atencao',
  inundacao: 'inundacao',
  severa: 'severa',
  critica: 'critica',
};

/**
 * Faixas da escala de nível (legenda de cotas), derivadas dos thresholds.
 * A faixa mais grave é aberta (max === null).
 * @param {object} [thresholds] — padrão: THRESHOLDS de config.js
 * @returns {{status: string, label: string, css: string, min: number, max: number|null}[]}
 */
function getLevelScale(thresholds = LEVEL_THRESHOLDS) {
  const bounds = [0, thresholds.atencao, thresholds.inundacao, thresholds.severa, thresholds.critica];
  return LEVEL_RANK_ORDER.map((status, i) => ({
    status,
    label: LEVEL_STATUS_LABELS[status],
    css: LEVEL_STATUS_CSS[status],
    min: bounds[i],
    max: i + 1 < bounds.length ? bounds[i + 1] : null,
  }));
}

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
 * Labels + classe css de um status de nível, prontos para renderização.
 * @param {number} levelMeters
 * @returns {{status: string, label: string, css: string}}
 */
function getLevelStatusInfo(levelMeters) {
  const status = getLevelStatus(levelMeters);
  return {
    status,
    label: LEVEL_STATUS_LABELS[status],
    css: LEVEL_STATUS_CSS[status],
  };
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

  // Envia notificação nativa do browser se habilitado e houve escalada
  if (escalated && notificationsEnabled()) {
    sendLevelNotification(levelReading, currentStatus);
  }
}

// === Notificações nativas (Notification API) ===

/**
 * Verifica se as notificações nativas estão habilitadas pelo usuário.
 * @returns {boolean}
 */
function notificationsEnabled() {
  return loadFromStorage('settings.notifications', false) &&
    'Notification' in window &&
    Notification.permission === 'granted';
}

/**
 * Pede permissão do usuário para enviar notificações nativas.
 * Persiste a preferência em localStorage.
 * @returns {Promise<boolean>} true se concedida
 */
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Seu navegador não suporta notificações nativas.', { type: 'warning' });
    return false;
  }
  if (Notification.permission === 'granted') {
    saveToStorage('settings.notifications', true);
    showToast('Notificações já estavam ativadas. ✅', { type: 'success' });
    return true;
  }
  if (Notification.permission === 'denied') {
    showToast('Permissão de notificações foi negada. Habilite nas configurações do navegador.', { type: 'warning' });
    return false;
  }
  const permission = await Notification.requestPermission();
  const granted = permission === 'granted';
  saveToStorage('settings.notifications', granted);
  if (granted) {
    showToast('Notificações ativadas! Você será avisado quando o nível subir. 🔔', { type: 'success' });
  } else {
    showToast('Notificações não ativadas.', { type: 'info' });
  }
  return granted;
}

/**
 * Desativa as notificações nativas (persiste a preferência).
 */
function disableNotifications() {
  saveToStorage('settings.notifications', false);
  showToast('Notificações desativadas.', { type: 'info' });
}

/**
 * Envia uma notificação nativa do browser sobre o nível do Guaíba.
 * @param {LevelReading} levelReading
 * @param {string} status — status atual (atencao, inundacao, etc)
 */
function sendLevelNotification(levelReading, status) {
  if (!notificationsEnabled() || !levelReading) return;
  const label = LEVEL_STATUS_LABELS[status] || 'ATENÇÃO';
  const title = `🌊 Guaíba ${label}: ${formatMeters(levelReading.levelMeters)}`;
  let body = `Nível em ${levelReading.location}.`;
  if (status === 'critica') body += ' Evacuação emergencial nas áreas de risco.';
  else if (status === 'severa') body += ' Inundações avançadas em áreas ribeirinhas.';
  else body += ' Monitore atualizações.';

  try {
    const n = new Notification(title, {
      body,
      icon: 'icons/icon-192.png',
      tag: 'guaiba-level',
      requireInteraction: status === 'critica' || status === 'severa',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    console.warn('[alerts] Notification falhou:', e.message);
  }
}

// === Exports ===
export {
  ALERT_SEVERITY,
  SEVERITY_RANK,
  LEVEL_THRESHOLDS,
  LEVEL_RANK_ORDER,
  LEVEL_STATUS_LABELS,
  LEVEL_STATUS_CSS,
  getLevelStatus,
  getLevelStatusInfo,
  getLevelScale,
  formatAlertSeverity,
  severityRank,
  sortAlertsBySeverity,
  getUrgentAlerts,
  formatAlertForDisplay,
  ensureToastContainer,
  showToast,
  checkLevelThreshold,
  notificationsEnabled,
  requestNotificationPermission,
  disableNotifications,
  sendLevelNotification,
};
