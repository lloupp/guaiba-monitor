import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, canSend, COOLDOWN_MS, MAX_EVENT_AGE_MS } from '../js/events.js';

const AGORA = new Date('2026-08-22T12:00:00.000Z').getTime();
const cotas = { atencao: 1.56, inundacao: 2.60, severa: 3.50, critica: 4.50 };

/** leitura de estação, recente por padrão */
const leitura = (over = {}) => ({
  stationCode: 'DCRS-00054',
  stationName: 'Barra do Ribeiro',
  levelMeters: 1.5,
  alarmStatus: 0,
  timestamp: new Date(AGORA - 5 * 60 * 1000).toISOString(),
  source: 'Defesa Civil RS (Rede Hidrometeorológica)',
  ...over,
});

const opts = (over = {}) => ({ now: AGORA, thresholdsFor: () => cotas, ...over });

test('alarme oficial ativado vira evento de emergência', () => {
  const ev = detectEvents(
    { stations: [leitura({ alarmStatus: 0 })], alerts: [] },
    { stations: [leitura({ alarmStatus: 2, levelMeters: 3.9 })], alerts: [] },
    opts({ thresholdsFor: () => null })
  );
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'alarm_activated');
  assert.equal(ev[0].severity, 'emergencia');
  assert.match(ev[0].body, /Defesa Civil/);
  assert.equal(ev[0].key, 'alarm:DCRS-00054');
});

test('alarme que já estava ativo não vira evento novo', () => {
  const ev = detectEvents(
    { stations: [leitura({ alarmStatus: 1 })], alerts: [] },
    { stations: [leitura({ alarmStatus: 1 })], alerts: [] },
    opts({ thresholdsFor: () => null })
  );
  assert.equal(ev.length, 0);
});

test('escalada de faixa só acontece onde a régua tem cota própria', () => {
  const antes = { stations: [leitura({ levelMeters: 1.4 })], alerts: [] };
  const depois = { stations: [leitura({ levelMeters: 2.9 })], alerts: [] };

  const comCota = detectEvents(antes, depois, opts());
  assert.equal(comCota.length, 1);
  assert.equal(comCota[0].type, 'level_escalated');
  assert.equal(comCota[0].severity, 'perigo'); // inundacao → perigo

  // mesma subida, régua sem cota publicada: nada é inventado
  const semCota = detectEvents(antes, depois, opts({ thresholdsFor: () => null }));
  assert.equal(semCota.length, 0);
});

test('dado simulado nunca vira notificação (regra 1)', () => {
  const ev = detectEvents(
    { stations: [leitura({ levelMeters: 1.4, source: 'simulação/offline' })], alerts: [] },
    { stations: [leitura({ levelMeters: 4.9, source: 'simulação/offline' })], alerts: [] },
    opts()
  );
  assert.equal(ev.length, 0);
});

test('leitura velha não dispara notificação (regra 2)', () => {
  const velha = new Date(AGORA - MAX_EVENT_AGE_MS - 60_000).toISOString();
  const ev = detectEvents(
    { stations: [leitura({ levelMeters: 1.4 })], alerts: [] },
    { stations: [leitura({ levelMeters: 4.9, timestamp: velha })], alerts: [] },
    opts()
  );
  assert.equal(ev.length, 0);
});

test('primeira leitura de uma estação não vira alerta (sem baseline)', () => {
  const ev = detectEvents(
    { stations: [], alerts: [] },
    { stations: [leitura({ levelMeters: 4.9, alarmStatus: 3 })], alerts: [] },
    opts()
  );
  assert.equal(ev.length, 0);
});

test('alerta da Defesa Civil sozinho não vira emergência (regra 4)', () => {
  const alerta = {
    id: 'dcrs-1', type: 'Defesa Civil', severity: 'emergencia',
    title: 'condição SEVERA', message: 'tempestade', regions: ['Quaraí'],
    source: 'Defesa Civil RS',
  };
  const ev = detectEvents({ stations: [], alerts: [] }, { stations: [], alerts: [alerta] }, opts());
  assert.equal(ev.length, 1);
  assert.equal(ev[0].severity, 'perigo', 'rebaixado: a severidade vem de heurística de título');

  // do INMET, a severidade é preservada
  const inmet = { ...alerta, id: 'inmet-1', source: 'INMET' };
  const ev2 = detectEvents({ stations: [], alerts: [] }, { stations: [], alerts: [inmet] }, opts());
  assert.equal(ev2[0].severity, 'emergencia');
});

test('alerta já visto e alerta informativo não notificam', () => {
  const a = (id, severity) => ({ id, severity, type: 'Chuva', title: 't', message: 'm', source: 'INMET' });
  const ev = detectEvents(
    { stations: [], alerts: [a('x', 'perigo')] },
    { stations: [], alerts: [a('x', 'perigo'), a('y', 'info')] },
    opts()
  );
  assert.equal(ev.length, 0);
});

test('cooldown segura o reenvio do mesmo evento', () => {
  const ev = { severity: 'perigo', key: 'level:X:severa' };
  assert.equal(canSend(ev, null, AGORA), true, 'nunca enviado → envia');
  assert.equal(canSend(ev, AGORA - 60_000, AGORA), false, 'enviado há 1 min → segura');
  assert.equal(canSend(ev, AGORA - COOLDOWN_MS.perigo - 1, AGORA), true, 'passou a janela → envia');
  // emergência tem janela mais curta que atenção
  assert.ok(COOLDOWN_MS.emergencia < COOLDOWN_MS.atencao);
});

test('cada evento traz ação concreta e destino', () => {
  const ev = detectEvents(
    { stations: [leitura({ levelMeters: 1.4 })], alerts: [] },
    { stations: [leitura({ levelMeters: 4.9 })], alerts: [] },
    opts()
  );
  assert.equal(ev[0].severity, 'emergencia');
  assert.match(ev[0].body, /ponto alto|193/i, 'diz o que fazer');
  assert.match(ev[0].url, /station=DCRS-00054/, 'abre na estação certa');
});

test('primeira rodada (sem snapshot anterior) não notifica nada', () => {
  // Cenário real: Worker recém-instalado, ou KV limpo. Sem esta regra, todos
  // os alertas ativos no momento viravam push de uma vez.
  const alertas = [
    { id: 'a1', severity: 'perigo', type: 'Chuva', title: 'x', message: 'y', source: 'INMET' },
    { id: 'a2', severity: 'emergencia', type: 'Vendaval', title: 'z', message: 'w', source: 'INMET' },
  ];
  assert.equal(detectEvents(null, { stations: [leitura({ alarmStatus: 3 })], alerts: alertas }, opts()).length, 0);
  assert.equal(detectEvents(undefined, { stations: [], alerts: alertas }, opts()).length, 0);

  // com baseline, o alerta novo passa a notificar normalmente
  const ev = detectEvents({ stations: [], alerts: [alertas[0]] }, { stations: [], alerts: alertas }, opts());
  assert.equal(ev.length, 1);
  assert.equal(ev[0].alertId, 'a2');
});

test('evento de estação carrega a bacia (senão a segmentação por bacia é letra morta)', () => {
  const ev = detectEvents(
    { stations: [leitura({ levelMeters: 1.4 })], alerts: [] },
    { stations: [leitura({ levelMeters: 2.9 })], alerts: [] },
    opts({ basinFor: () => 'RS - Lago Guaíba' })
  );
  assert.equal(ev.length, 1);
  assert.equal(ev[0].basin, 'RS - Lago Guaíba');

  // sem basinFor, o campo existe e é null — nunca undefined silencioso
  const semBacia = detectEvents(
    { stations: [leitura({ levelMeters: 1.4 })], alerts: [] },
    { stations: [leitura({ levelMeters: 2.9 })], alerts: [] },
    opts()
  );
  assert.equal(semBacia[0].basin, null);
});
