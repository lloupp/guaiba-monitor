// config.js — Configuração única do projeto (fonte de verdade)
//
// Centraliza thresholds e estações de referência, carregados do
// data/ref-levels.json quando disponível. Mantém os valores padrão como
// fallback offline. Os objetos são mutados in-place após o fetch para que
// módulos que fazem acesso síncrono (ex.: THRESHOLDS.critica) continuem
// funcionando sem re-importar.
//
// Uso:
//   import { THRESHOLDS, STATIONS, loadConfig } from './config.js';

export const THRESHOLDS = {
  atencao: 1.5,
  inundacao: 2.0,
  severa: 2.5,
  critica: 3.0,
  referencia_mai2024: 5.3,
};

export const STATIONS = [];

let loaded = false;

/**
 * Carrega data/ref-levels.json e sobrepõe os valores padrão.
 * É seguro chamar múltiplas vezes (idempotente) ou nunca chamar (offline).
 * @returns {Promise<{THRESHOLDS: object, STATIONS: object[]}>}
 */
export async function loadConfig() {
  if (loaded) return { THRESHOLDS, STATIONS };
  try {
    const res = await fetch('data/ref-levels.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.thresholds) Object.assign(THRESHOLDS, json.thresholds);
    if (Array.isArray(json.stations)) {
      STATIONS.length = 0;
      STATIONS.push(...json.stations);
    }
    loaded = true;
  } catch (err) {
    console.warn('[config] Falha ao carregar ref-levels.json — usando padrões offline.', err.message);
  }
  return { THRESHOLDS, STATIONS };
}

export default { THRESHOLDS, STATIONS, loadConfig };
