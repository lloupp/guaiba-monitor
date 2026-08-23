// config.js — Configuração única do projeto (fonte de verdade)
//
// Carrega data/ref-levels.json e expõe:
//   THRESHOLDS  — cotas de REFERÊNCIA da régua do Gasômetro (ANA/SGB 87450020).
//                 Servem para as linhas do gráfico e a legenda do Guaíba.
//                 NÃO classificam leituras de outras réguas: cada estação tem
//                 zero próprio (ver notes em data/ref-levels.json).
//   STATIONS    — catálogo de estações com cotas próprias (ou null) e procedência.
//
// Os objetos são mutados in-place após o fetch para que módulos com acesso
// síncrono (ex.: THRESHOLDS.critica) continuem funcionando sem re-importar.
//
// Uso:
//   import { THRESHOLDS, STATIONS, getStationThresholds, loadConfig } from './config.js';

export const THRESHOLDS = {
  // Régua da Usina do Gasômetro (ANA 87450020) — referência histórica do Guaíba.
  atencao: 1.56,
  inundacao: 2.60,
  severa: 3.50,
  critica: 4.50,
  referencia_mai2024: 5.30,
  cota_gasometro: 2.60,
  cota_cais_maua: 3.00,
};

export const STATIONS = [];

let loaded = false;

/**
 * Cotas da estação, quando existem e foram validadas.
 * Estação fora do catálogo, ou sem cota publicada para a sua régua, retorna
 * null — e nesse caso a classificação NÃO deve usar cota nenhuma (usa o
 * alarme oficial da rede; ver js/alerts.js#classifyReading).
 *
 * @param {string} stationCode — ex.: 'DCRS-00054'
 * @returns {{atencao: number, inundacao: number, severa: number, critica: number}|null}
 */
export function getStationThresholds(stationCode) {
  if (!stationCode) return null;
  const station = STATIONS.find((s) => s.id === stationCode);
  return station && station.thresholds ? station.thresholds : null;
}

/**
 * Metadados da estação no catálogo (nome, rede, procedência das cotas).
 * @param {string} stationCode
 * @returns {object|null}
 */
export function getStationInfo(stationCode) {
  if (!stationCode) return null;
  return STATIONS.find((s) => s.id === stationCode) || null;
}

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
    // referenceThresholds é o formato atual; thresholds é o formato antigo.
    const ref = json.referenceThresholds || json.thresholds;
    if (ref) {
      for (const [k, v] of Object.entries(ref)) {
        if (!k.startsWith('_')) THRESHOLDS[k] = v;
      }
    }
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

export default { THRESHOLDS, STATIONS, getStationThresholds, getStationInfo, loadConfig };
