// events.js — Detecção dos eventos que viram notificação.
//
// Compara o snapshot anterior com o atual e devolve o que merece acordar
// alguém no meio da noite. Função pura: mesma entrada, mesma saída — é o que
// permite testá-la sem rede e sem push real.
//
// REGRAS DURAS (nenhuma é negociável; um alerta falso custa a confiança de
// quem depende do app, e um alerta perdido custa mais que isso):
//   1. Dado marcado como simulação/offline NUNCA vira notificação.
//   2. Leitura mais velha que MAX_EVENT_AGE_MS não dispara nada — se a coleta
//      travou, o silêncio é honesto; alerta com dado velho, não.
//   3. Cota de uma régua não classifica outra (mesma regra do app).
//   4. Alerta da Defesa Civil, sozinho, não vira emergência: a severidade dele
//      é heurística de título (ver js/sources.js#parseDcrsRss).
//   5. Todo evento traz uma chave estável (`key`) para o cooldown — a mesma
//      escalada não notifica duas vezes.

import { classifyReading, LEVEL_RANK_ORDER, LEVEL_STATUS_LABELS, severityRank } from './alerts.js';
import { formatMeters } from './utils.js';

// Idade máxima da leitura para que ela possa gerar notificação.
export const MAX_EVENT_AGE_MS = 60 * 60 * 1000;

// Quanto tempo o mesmo evento fica em silêncio depois de enviado.
export const COOLDOWN_MS = {
  atencao: 6 * 60 * 60 * 1000,
  perigo: 3 * 60 * 60 * 1000,
  emergencia: 60 * 60 * 1000,
};

// O que fazer, por gravidade. Uma notificação sem ação é só um susto.
const ACTION_BY_STATUS = {
  atencao: 'Acompanhe e prepare o que precisa levar.',
  inundacao: 'Tire do chão o que não pode molhar e prepare a saída.',
  severa: 'Saia das áreas baixas agora. Leve documentos e remédios.',
  critica: 'Vá para um ponto alto imediatamente. Em risco, ligue 193.',
  alarme: 'Alarme oficial de inundação. Siga as orientações da Defesa Civil (199).',
};

const SEVERITY_BY_STATUS = {
  atencao: 'atencao',
  inundacao: 'perigo',
  severa: 'perigo',
  critica: 'emergencia',
  alarme: 'emergencia',
};

/** O dado é simulado? Portão de segurança da regra 1. */
function isSimulated(obj) {
  const s = String(obj?.source || '').toLowerCase();
  return s.includes('simulação') || s.includes('simulacao') || s.includes('offline') || s.includes('fallback');
}

/** A leitura é recente o bastante para notificar? Regra 2. */
function isRecent(reading, now, maxAge = MAX_EVENT_AGE_MS) {
  const ts = reading?.timestamp || reading?.recordedAt;
  if (!ts) return false;
  const age = now - new Date(ts).getTime();
  return !Number.isNaN(age) && age >= 0 && age <= maxAge;
}

/**
 * Eventos entre dois snapshots.
 *
 * @param {{stations: object[], alerts: object[]}|null} prev
 * @param {{stations: object[], alerts: object[]}} curr
 * @param {object} [opts]
 * @param {number} [opts.now] — timestamp (ms) para testes determinísticos
 * @param {function} [opts.thresholdsFor] — (stationCode) => cotas|null
 * @param {function} [opts.basinFor] — (stationCode) => bacia|null, para segmentar o envio
 * @returns {object[]} eventos prontos para virar notificação
 */
export function detectEvents(prev, curr, opts = {}) {
  // Sem snapshot anterior não há "mudou": é a primeira coleta, ou o estado se
  // perdeu. Notificar aqui despejaria todos os alertas ativos de uma vez em
  // quem acabou de instalar — esta rodada só serve para criar a linha de base.
  if (!prev) return [];

  const now = opts.now ?? Date.now();
  const thresholdsFor = opts.thresholdsFor || (() => null);
  // A bacia não vem na leitura (ela mora no catálogo, para o realtime.json não
  // repetir o mesmo texto 130 vezes). Sem ela no evento, quem se inscreveu
  // acompanhando a bacia — e não aquela estação exata — nunca seria avisado.
  const basinFor = opts.basinFor || (() => null);
  const events = [];

  const before = new Map(
    ((prev && prev.stations) || []).map((s) => [s.stationCode, s])
  );

  for (const station of (curr.stations || [])) {
    if (isSimulated(station) || !isRecent(station, now)) continue;
    const anterior = before.get(station.stationCode);
    if (!anterior) continue; // sem baseline não há escalada, só primeira leitura

    events.push(...stationEvents(
      anterior,
      station,
      thresholdsFor(station.stationCode),
      basinFor(station.stationCode)
    ));
  }

  events.push(...alertEvents(prev, curr));

  return events;
}

/**
 * Eventos de uma estação entre duas leituras.
 * @param {object} antes @param {object} agora
 * @param {object|null} thresholds @param {string|null} basin
 * @returns {object[]}
 */
function stationEvents(antes, agora, thresholds, basin = null) {
  const events = [];
  const local = agora.stationName || agora.stationCode;

  // 1) Alarme oficial de inundação foi ativado.
  const alarmeAntes = Number(antes.alarmStatus) > 0;
  const alarmeAgora = Number(agora.alarmStatus) > 0;
  if (!alarmeAntes && alarmeAgora) {
    events.push({
      type: 'alarm_activated',
      severity: 'emergencia',
      stationCode: agora.stationCode,
      stationName: local,
      basin,
      key: `alarm:${agora.stationCode}`,
      title: `🚨 Alarme de inundação: ${local}`,
      body: `${formatMeters(agora.levelMeters)}. ${ACTION_BY_STATUS.alarme}`,
      tag: `alarm-${agora.stationCode}`,
      url: `./index.html?station=${encodeURIComponent(agora.stationCode)}&source=push`,
    });
  }

  // 2) Escalada de faixa — só onde a régua tem cota própria (regra 3).
  if (thresholds) {
    const statusAntes = classifyReading(antes, thresholds).status;
    const statusAgora = classifyReading(agora, thresholds).status;
    const rankAntes = LEVEL_RANK_ORDER.indexOf(statusAntes);
    const rankAgora = LEVEL_RANK_ORDER.indexOf(statusAgora);

    if (rankAgora > rankAntes && rankAgora > 0) {
      events.push({
        type: 'level_escalated',
        severity: SEVERITY_BY_STATUS[statusAgora] || 'atencao',
        stationCode: agora.stationCode,
        stationName: local,
        basin,
        key: `level:${agora.stationCode}:${statusAgora}`,
        title: `⚠️ ${local}: ${LEVEL_STATUS_LABELS[statusAgora]}`,
        body: `${formatMeters(agora.levelMeters)}. ${ACTION_BY_STATUS[statusAgora] || ''}`.trim(),
        tag: `level-${agora.stationCode}`,
        url: `./index.html?station=${encodeURIComponent(agora.stationCode)}&source=push`,
      });
    }
  }

  return events;
}

/**
 * Eventos de alertas novos (INMET / Defesa Civil RS).
 * @param {object|null} prev @param {object} curr
 * @returns {object[]}
 */
function alertEvents(prev, curr) {
  const vistos = new Set(((prev && prev.alerts) || []).map((a) => a.id).filter(Boolean));
  const events = [];

  for (const alerta of (curr.alerts || [])) {
    if (isSimulated(alerta)) continue;
    if (alerta.id && vistos.has(alerta.id)) continue;
    if (severityRank(alerta.severity) <= 0) continue; // 'info' não acorda ninguém

    // Regra 4: severidade da Defesa Civil vem de heurística de título.
    const daDefesaCivil = String(alerta.source || '').toLowerCase().includes('defesa civil');
    const severity = daDefesaCivil && alerta.severity === 'emergencia' ? 'perigo' : alerta.severity;

    const regioes = Array.isArray(alerta.regions) && alerta.regions.length
      ? alerta.regions.join(', ')
      : 'Rio Grande do Sul';

    events.push({
      type: 'new_alert',
      severity,
      regions: Array.isArray(alerta.regions) ? alerta.regions : [],
      alertId: alerta.id,
      key: `alert:${alerta.id}`,
      title: `${alerta.type || 'Alerta'}: ${alerta.title || ''}`.trim(),
      body: `${regioes}. ${(alerta.message || '').slice(0, 180)}`.trim(),
      tag: `alert-${alerta.id}`,
      url: './index.html?source=push&focus=alerts',
    });
  }

  return events;
}

/**
 * O evento pode ser enviado agora, ou ainda está no cooldown?
 * @param {object} evento
 * @param {number|null} enviadoEm — timestamp do último envio desta chave
 * @param {number} [now]
 * @returns {boolean}
 */
export function canSend(evento, enviadoEm, now = Date.now()) {
  if (!enviadoEm) return true;
  const janela = COOLDOWN_MS[evento.severity] ?? COOLDOWN_MS.atencao;
  return now - enviadoEm >= janela;
}
