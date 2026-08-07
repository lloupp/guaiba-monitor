// utils.js — Funções utilitárias

export function formatMeters(value) {
  return (value || 0).toFixed(2) + ' m';
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export function saveToStorage(key, data) {
  try {
    localStorage.setItem(`gm_${key}`, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

export function loadFromStorage(key, fallback = null) {
  try {
    const data = localStorage.getItem(`gm_${key}`);
    return data ? JSON.parse(data) : fallback;
  } catch (e) { return fallback; }
}

export function formatDate(dateString) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export function riskColor(level) {
  const map = { baixo: 'var(--green)', moderado: 'var(--yellow)', alto: 'var(--red)', critico: 'var(--red)' };
  return map[level] || 'var(--text-secondary)';
}

/**
 * Escapa caracteres HTML para evitar injeção (XSS) ao injetar dados
 * externos (INMET/DCRS) via innerHTML.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
