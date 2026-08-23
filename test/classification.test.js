import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyReading, getLevelStatus } from '../js/alerts.js';
import { STATIONS, getStationThresholds, getStationInfo } from '../js/config.js';
import * as api from '../js/api.js';

const REF_LEVELS = JSON.parse(readFileSync(new URL('../data/ref-levels.json', import.meta.url), 'utf8'));

// O catálogo real do projeto alimenta os testes (config.js só o carrega via
// fetch no browser).
STATIONS.length = 0;
STATIONS.push(...REF_LEVELS.stations);

test('cotas são por estação — régua da DCRS não herda a cota do Gasômetro', () => {
  assert.equal(getStationThresholds('DCRS-00054'), null);
  assert.equal(getStationThresholds('DCRS-00033'), null);
  assert.equal(getStationThresholds('87450020').inundacao, 2.60);
  assert.equal(getStationThresholds('87450004').inundacao, 3.00);
  assert.equal(getStationThresholds('estação-inexistente'), null);
});

test('estação com cota oficial é classificada pela própria faixa', () => {
  const t = getStationThresholds('87450020');
  const c = classifyReading({ levelMeters: 2.9 }, t);
  assert.equal(c.kind, 'cota');
  assert.equal(c.status, 'inundacao');
  assert.match(c.basis, /2\.60/);
});

test('estação sem cota usa o alarme oficial da rede', () => {
  const semAlarme = classifyReading({ levelMeters: 1.54, alarmStatus: 0 }, null);
  assert.equal(semAlarme.kind, 'alarme');
  assert.equal(semAlarme.status, 'normal');
  assert.equal(semAlarme.label, 'SEM ALARME');

  const comAlarme = classifyReading({ levelMeters: 4.2, alarmStatus: 1 }, null);
  assert.equal(comAlarme.kind, 'alarme');
  assert.equal(comAlarme.status, 'alarme');
  assert.match(comAlarme.basis, /Defesa Civil/);
});

test('sem cota e sem alarme, o app admite que não sabe classificar', () => {
  const c = classifyReading({ levelMeters: 1.54 }, null);
  assert.equal(c.kind, 'indisponivel');
  assert.equal(c.label, 'SEM REFERÊNCIA');
});

test('sem leitura, a classificação é SEM LEITURA (nunca um número)', () => {
  assert.equal(classifyReading(null, null).label, 'SEM LEITURA');
  assert.equal(classifyReading({ levelMeters: null }, null).label, 'SEM LEITURA');
});

test('getLevelStatus respeita as cotas recebidas', () => {
  const gasometro = getStationThresholds('87450020');
  const caisMaua = getStationThresholds('87450004');
  // 2.80 m passa da cota do Gasômetro (2.60) mas não da do Cais Mauá (3.00).
  assert.equal(getLevelStatus(2.8, gasometro), 'inundacao');
  assert.equal(getLevelStatus(2.8, caisMaua), 'atencao');
});

test('api.js não expõe dados de exemplo (regressão da Fase 0)', () => {
  for (const name of ['sampleLevels', 'sampleAlerts', 'sampleWeather']) {
    assert.equal(api[name], undefined, `api.js não pode exportar ${name}`);
  }
});

test('isFresh serve para decidir alerta, não para esconder leitura', () => {
  const agora = new Date().toISOString();
  const duasHoras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(api.isFresh(agora), true);
  assert.equal(api.isFresh(duasHoras), false);
  // a idade continua disponível para ser exibida
  assert.ok(api.ageMs(duasHoras) > 60 * 60 * 1000);
});

test('catálogo de estações registra a procedência das cotas', () => {
  const gasometro = getStationInfo('87450020');
  assert.ok(gasometro.thresholdsSource, 'cota precisa dizer de onde veio');
  assert.ok(gasometro.verifiedAt, 'cota precisa dizer quando foi verificada');
});
