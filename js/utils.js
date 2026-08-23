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

/**
 * Minúsculas sem acento — para comparar nomes de lugar vindos de fontes
 * diferentes ("Guaíba" no RSS, "GUAIBA" no título de um boletim).
 * @param {string} str
 * @returns {string}
 */
export function normalizePlace(str) {
  return String(str == null ? '' : str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Municípios contidos no nome de uma estação.
 * "Santo Antônio das Missões/São Borja" → ["Santo Antônio das Missões", "São Borja"]
 * "Barra do Ribeiro - Lago Guaíba"      → ["Barra do Ribeiro"]
 * @param {string} stationName
 * @returns {string[]}
 */
export function placesFromStationName(stationName) {
  const base = String(stationName || '')
    .replace(/\([^)]*\)/g, ' ')                                  // "(H)", "(Auxiliar)"
    .replace(/\s*-\s*(rio|arroio|lago|centro|barragem)\b.*/i, ' '); // sufixo do corpo d'água
  return base
    .split(/[/,]/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 4);
}

/**
 * Distância em km entre dois pontos (haversine).
 * As distâncias aqui são de dezenas a centenas de km, onde a aproximação
 * plana já erraria o suficiente para escolher a estação errada.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number}
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
