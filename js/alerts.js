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
  alarme: 'ALARME OFICIAL',
  desconhecido: 'SEM REFERÊNCIA',
};

// Classe de badge CSS por status (a mesma chave do status)
const LEVEL_STATUS_CSS = {
  normal: 'normal',
  atencao: 'atencao',
  inundacao: 'inundacao',
  severa: 'severa',
  critica: 'critica',
  alarme: 'critica',
  desconhecido: 'desconhecido',
};

/**
 * Classifica o nível do rio em uma categoria de risco, usando as cotas
 * informadas. Cada régua tem zero próprio: passe SEMPRE as cotas da estação
 * (config.js#getStationThresholds). O default só existe para a régua de
 * referência do Guaíba (Gasômetro).
 *
 * @param {number} levelMeters — nível em metros
 * @param {object} [thresholds] — {atencao, inundacao, severa, critica}
 * @returns {'normal'|'atencao'|'inundacao'|'severa'|'critica'}
 */
function getLevelStatus(levelMeters, thresholds = LEVEL_THRESHOLDS) {
  const t = thresholds || LEVEL_THRESHOLDS;
  const l = parseFloat(levelMeters);
  if (l >= t.critica) return 'critica';
  if (l >= t.severa) return 'severa';
  if (l >= t.inundacao) return 'inundacao';
  if (l >= t.atencao) return 'atencao';
  return 'normal';
}

/**
 * Labels + classe css de um status de nível, prontos para renderização.
 * @param {number} levelMeters
 * @param {object} [thresholds] — cotas da estação
 * @returns {{status: string, label: string, css: string}}
 */
function getLevelStatusInfo(levelMeters, thresholds = LEVEL_THRESHOLDS) {
  const status = getLevelStatus(levelMeters, thresholds);
  return {
    status,
    label: LEVEL_STATUS_LABELS[status],
    css: LEVEL_STATUS_CSS[status],
  };
}

/**
 * Classifica uma leitura sem nunca emprestar cota de outra régua.
 *
 * Ordem de decisão:
 *   1. 'cota'         — a estação tem cota oficial validada → status por faixa;
 *   2. 'alarme'       — sem cota, mas a rede publica alarme oficial de
 *                       inundação (DCRS rio_alarmes.inundacao.status):
 *                       0 = sem alarme, > 0 = alarme oficial ativo;
 *   3. 'indisponivel' — nada disso: mostra só nível, tendência e variação.
 *
 * @param {{levelMeters: number, alarmStatus?: number|null}} reading
 * @param {object|null} [thresholds] — cotas da estação, ou null
 * @returns {{kind: string, status: string, label: string, css: string, basis: string}}
 */
function classifyReading(reading, thresholds) {
  if (!reading || reading.levelMeters == null) {
    return {
      kind: 'indisponivel',
      status: 'desconhecido',
      label: 'SEM LEITURA',
      css: 'desconhecido',
      basis: 'Nenhuma leitura disponível para esta estação.',
    };
  }

  if (thresholds && thresholds.inundacao != null) {
    const info = getLevelStatusInfo(reading.levelMeters, thresholds);
    return {
      kind: 'cota',
      status: info.status,
      label: info.label,
      css: info.css,
      basis: `Cota oficial desta régua (inundação em ${thresholds.inundacao.toFixed(2)} m).`,
    };
  }

  const alarm = reading.alarmStatus;
  if (alarm != null && !Number.isNaN(Number(alarm))) {
    const active = Number(alarm) > 0;
    return {
      kind: 'alarme',
      status: active ? 'alarme' : 'normal',
      label: active ? 'ALARME OFICIAL' : 'SEM ALARME',
      css: active ? 'critica' : 'normal',
      basis: active
        ? `Alarme de inundação ativo na estação (nível ${alarm} publicado pela Defesa Civil RS).`
        : 'A Defesa Civil RS não registra alarme de inundação nesta estação.',
    };
  }

  return {
    kind: 'indisponivel',
    status: 'desconhecido',
    label: 'SEM REFERÊNCIA',
    css: 'desconhecido',
    basis: 'Esta régua não tem cota oficial publicada — acompanhe o número e a variação.',
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
 * Verifica se a leitura atual escalou de status em relação à anterior e avisa
 * o usuário. Só avisa quando existe base real de classificação (cota oficial
 * da própria régua ou alarme oficial da rede) — nunca por cota emprestada.
 *
 * Usa localStorage (prefixo gm_) para lembrar o estado entre recargas:
 *   - gm_levels.last_status      — status da última leitura
 *   - gm_settings.alertThreshold — limiar em metros definido pelo usuário
 *
 * @param {object} levelReading — leitura atual ({levelMeters, location, alarmStatus})
 * @param {number} [userThreshold] — limiar do usuário, em metros (opcional)
 * @param {object|null} [thresholds] — cotas da estação (config.js#getStationThresholds)
 */
function checkLevelThreshold(levelReading, userThreshold, thresholds = null) {
  if (!levelReading || levelReading.levelMeters == null) return;

  const classification = classifyReading(levelReading, thresholds);
  const prevStatus = loadFromStorage('levels.last_status', null);

  // Sem base de classificação: registra o estado e não inventa alerta.
  if (classification.kind === 'indisponivel') {
    saveToStorage('levels.last_status', classification.status);
    checkUserThreshold(levelReading, userThreshold);
    return;
  }

  const currentStatus = classification.status;
  const prevRank = prevStatus ? LEVEL_RANK_ORDER.indexOf(prevStatus) : -1;
  const currRank = LEVEL_RANK_ORDER.indexOf(currentStatus);
  const escalated = prevStatus && currRank > -1 && prevRank > -1 && currRank > prevRank;

  if (escalated) {
    const label = LEVEL_STATUS_LABELS[currentStatus] || classification.label;
    let toastMsg = `Nível ${label}: ${formatMeters(levelReading.levelMeters)} (${levelReading.location}).`;
    if (currentStatus === 'critica') {
      toastMsg += ' Evacuação emergencial nas áreas de risco às margens.';
    } else if (currentStatus === 'severa') {
      toastMsg += ' Inundações avançadas em áreas ribeirinhas.';
    } else {
      toastMsg += ' Monitore atualizações.';
    }
    showToast(toastMsg, { type: 'danger', duration: 8000 });
  } else if (classification.kind === 'alarme' && currentStatus === 'alarme' && prevStatus !== 'alarme') {
    showToast(
      `Alarme oficial de inundação em ${levelReading.location} — ${formatMeters(levelReading.levelMeters)}. Fonte: Defesa Civil RS.`,
      { type: 'danger', duration: 8000 }
    );
  }

  saveToStorage('levels.last_status', currentStatus);

  if (!escalated) checkUserThreshold(levelReading, userThreshold);

  if ((escalated || currentStatus === 'alarme') && notificationsEnabled()) {
    sendLevelNotification(levelReading, currentStatus);
  }
}

/**
 * Avisa quando a leitura passa do limiar que o próprio usuário definiu.
 * Só dispara quando o usuário configurou um limiar — o app não inventa um.
 * @param {object} levelReading
 * @param {number} [userThreshold]
 */
function checkUserThreshold(levelReading, userThreshold) {
  const threshold = userThreshold != null
    ? userThreshold
    : loadFromStorage('settings.alertThreshold', null);
  if (threshold == null) return;

  const above = levelReading.levelMeters >= threshold;
  const wasAbove = loadFromStorage('levels.above_user_threshold', false);
  saveToStorage('levels.above_user_threshold', above);

  if (above && !wasAbove) {
    showToast(
      `Nível atingiu ${formatMeters(levelReading.levelMeters)} — acima do seu limiar de ${formatMeters(threshold)} (${levelReading.location}).`,
      { type: 'warning', duration: 6000 }
    );
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
  classifyReading,
  formatAlertSeverity,
  severityRank,
  sortAlertsBySeverity,
  getUrgentAlerts,
  formatAlertForDisplay,
  ensureToastContainer,
  showToast,
  checkLevelThreshold,
  checkUserThreshold,
  notificationsEnabled,
  requestNotificationPermission,
  disableNotifications,
  sendLevelNotification,
};
