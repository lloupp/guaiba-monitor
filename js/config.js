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
  // Cotas oficiais pós-2024 (validado via nivelguaiba.com.br / ANA-SGB)
  // Estação Usina do Gasômetro (ANA 87450020): cota de inundação 2.60m
  // Estação Cais Mauá C6 (ANA 87450004): cota de inundação 3.00m
  // Usamos a régua do Gasômetro (2.60m) como referência principal.
  atencao: 1.56,       // 60% da cota de inundação → status "alerta" no nivelguaiba
  inundacao: 2.60,     // Cota de inundação oficial (Gasômetro)
  severa: 3.50,        // Inundação severa
  critica: 4.50,       // Crítica (maio/2024 chegou a 5.30m)
  referencia_mai2024: 5.30,
  cota_gasometro: 2.60,
  cota_cais_maua: 3.00,
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
