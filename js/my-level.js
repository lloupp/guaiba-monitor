// my-level.js — "Quanto falta até a minha casa".
//
// O número do rio, sozinho, não responde a pergunta que importa: *isso me
// atinge?* Aqui a pessoa registra a referência dela na mesma régua que o app
// mostra, e passa a ver a distância em centímetros e o tempo estimado no ritmo
// atual.
//
// Duas honestidades embutidas:
//   - a referência é por estação (réguas têm zeros diferentes);
//   - a projeção é uma conta simples sobre a tendência recente, e é
//     apresentada como estimativa, nunca como previsão.

import { loadFromStorage, saveToStorage, formatMeters } from './utils.js';

const STORAGE_KEY = 'myLevel';

/**
 * Referência salva para uma estação.
 * @param {string} stationCode
 * @returns {{meters: number, label: string}|null}
 */
export function getMyLevel(stationCode) {
  if (!stationCode) return null;
  const todos = loadFromStorage(STORAGE_KEY, {}) || {};
  const registro = todos[stationCode];
  return registro && typeof registro.meters === 'number' ? registro : null;
}

/**
 * Salva (ou apaga, com meters null) a referência da pessoa nesta estação.
 * @param {string} stationCode
 * @param {number|null} meters
 * @param {string} [label]
 */
export function setMyLevel(stationCode, meters, label = '') {
  const todos = loadFromStorage(STORAGE_KEY, {}) || {};
  if (meters == null || Number.isNaN(meters)) delete todos[stationCode];
  else todos[stationCode] = { meters, label, savedAt: new Date().toISOString() };
  saveToStorage(STORAGE_KEY, todos);
}

/**
 * Velocidade de subida em metros por hora, a partir do histórico recente.
 *
 * Usa a primeira e a última leitura da janela em vez de regressão: com poucos
 * pontos e ruído de telemetria, a conta simples é mais previsível — e o
 * resultado é apresentado como estimativa de qualquer forma.
 *
 * @param {object[]} readings — ordenadas por tempo, com {levelMeters, recordedAt}
 * @param {number} [janelaHoras]
 * @returns {number|null} m/h, ou null sem dados suficientes
 */
export function riseRatePerHour(readings, janelaHoras = 6) {
  if (!Array.isArray(readings) || readings.length < 2) return null;

  const agora = new Date(readings[readings.length - 1].recordedAt).getTime();
  const corte = agora - janelaHoras * 60 * 60 * 1000;
  const janela = readings.filter((r) => new Date(r.recordedAt).getTime() >= corte);
  if (janela.length < 2) return null;

  const primeiro = janela[0];
  const ultimo = janela[janela.length - 1];
  const horas = (new Date(ultimo.recordedAt).getTime() - new Date(primeiro.recordedAt).getTime()) / 3_600_000;
  if (horas <= 0) return null;

  return (ultimo.levelMeters - primeiro.levelMeters) / horas;
}

/**
 * Situação da referência da pessoa em relação ao nível atual.
 *
 * @param {number} nivelAtual — metros
 * @param {number} minhaReferencia — metros, na mesma régua
 * @param {number|null} taxaPorHora — de riseRatePerHour
 * @returns {{alcancado: boolean, faltamCm: number, subindo: boolean, horas: number|null, texto: string}}
 */
export function statusMyLevel(nivelAtual, minhaReferencia, taxaPorHora) {
  const diferenca = minhaReferencia - nivelAtual;
  const faltamCm = Math.round(diferenca * 100);
  const subindo = taxaPorHora != null && taxaPorHora > 0.001;

  if (diferenca <= 0) {
    const acimaCm = Math.abs(faltamCm);
    return {
      alcancado: true,
      faltamCm: 0,
      subindo,
      horas: null,
      texto: `A água já passou da sua referência em ${acimaCm} cm. Se ainda não saiu, saia agora.`,
    };
  }

  if (!subindo) {
    return {
      alcancado: false,
      faltamCm,
      subindo: false,
      horas: null,
      texto: `Faltam ${faltamCm} cm até a sua referência. O nível não está subindo agora.`,
    };
  }

  const horas = diferenca / taxaPorHora;
  return {
    alcancado: false,
    faltamCm,
    subindo: true,
    horas,
    texto: `Faltam ${faltamCm} cm. No ritmo das últimas horas, isso levaria cerca de ${formatarDuracao(horas)} — estimativa grosseira, o rio pode acelerar.`,
  };
}

/**
 * Duração em texto curto e legível.
 * @param {number} horas
 * @returns {string}
 */
export function formatarDuracao(horas) {
  if (!Number.isFinite(horas) || horas <= 0) return 'pouco tempo';
  if (horas < 1) return `${Math.round(horas * 60)} minutos`;
  if (horas < 24) {
    const h = Math.floor(horas);
    const m = Math.round((horas - h) * 60);
    return m >= 5 ? `${h}h${String(m).padStart(2, '0')}` : `${h} hora${h > 1 ? 's' : ''}`;
  }
  const dias = Math.round(horas / 24);
  return `${dias} dia${dias > 1 ? 's' : ''}`;
}

/**
 * Texto de resumo para compartilhar (WhatsApp e afins).
 * @param {object} params
 * @returns {string}
 */
export function textoParaCompartilhar({ estacao, nivel, quando, status, url }) {
  const linhas = [
    `🌊 ${estacao}: ${formatMeters(nivel)} (${quando})`,
  ];
  if (status) linhas.push(status.texto);
  linhas.push('Fonte: Defesa Civil RS · Emergência: 199');
  if (url) linhas.push(url);
  return linhas.join('\n');
}
