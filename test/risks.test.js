import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFloodRisk,
  getDrainageRisk,
  getCycloneBombRisk,
  getLandslideRisk,
  getRegionOverallRisk,
  getRisksByRegion,
  riskRank,
  buildRegionRisks,
  floodRiskFromAlarm,
  DISASTER_ORDER,
} from '../js/risks.js';
import { THRESHOLDS } from '../js/config.js';
import { sampleRegionRisks } from './fixtures/samples.js';

test('THRESHOLDS vem de config.js — régua de referência do Gasômetro', () => {
  // Cotas da régua ANA/SGB 87450020 — ver js/config.js / data/ref-levels.json
  assert.equal(THRESHOLDS.atencao, 1.56);
  assert.equal(THRESHOLDS.inundacao, 2.60);
  assert.equal(THRESHOLDS.severa, 3.50);
  assert.equal(THRESHOLDS.critica, 4.50);
});

test('getFloodRisk classifica corretamente pelos thresholds', () => {
  assert.equal(getFloodRisk(0.5).riskLevel, 'baixo');
  assert.equal(getFloodRisk(1.6).riskLevel, 'moderado');   // ≥ atencao (1.56)
  assert.equal(getFloodRisk(2.4).riskLevel, 'moderado');   // atencao..inundacao
  assert.equal(getFloodRisk(2.7).riskLevel, 'moderado');   // ≥ inundacao (2.60)
  assert.equal(getFloodRisk(3.6).riskLevel, 'alto');       // ≥ severa (3.50)
  assert.equal(getFloodRisk(4.6).riskLevel, 'critico');    // ≥ critica (4.50)
});

test('getDrainageRisk considera nível + tendência', () => {
  assert.equal(getDrainageRisk(1.2, 'estavel').riskLevel, 'baixo');   // < atencao
  assert.equal(getDrainageRisk(2.2, 'estavel').riskLevel, 'baixo');   // atencao..inundacao (amarelo)
  assert.equal(getDrainageRisk(2.2, 'subindo').riskLevel, 'baixo');   // ainda abaixo da inundação
  assert.equal(getDrainageRisk(2.7, 'subindo').riskLevel, 'moderado'); // ≥ inundação + subindo
  assert.equal(getDrainageRisk(3.6, 'estavel').riskLevel, 'alto');    // ≥ severa
});

test('getCycloneBombRisk eleva risco em nível subindo', () => {
  assert.equal(getCycloneBombRisk(1.2, 'estavel', []).riskLevel, 'baixo');
  assert.equal(getCycloneBombRisk(2.2, 'subindo', []).riskLevel, 'baixo'); // ≥ atencao mas < inundação
  assert.equal(getCycloneBombRisk(2.7, 'subindo', []).riskLevel, 'moderado'); // ≥ inundação + subindo
});

test('a matriz cobre todas as regiões e tipos de desastre, marcadas simulação', () => {
  const matrix = sampleRegionRisks(buildRegionRisks);
  const regionNames = new Set(matrix.map(r => r.region));
  assert.ok(regionNames.has('Porto Alegre'));
  assert.ok(regionNames.has('Canoas'));
  assert.ok(regionNames.has('Guaíba'));

  const poaRisks = matrix.filter(r => r.region === 'Porto Alegre');
  for (const key of DISASTER_ORDER) {
    assert.ok(poaRisks.some(r => r.disasterType === key), `faltou tipo ${key}`);
  }
  assert.ok(matrix.every(r => r.source === 'simulação/offline'));
});

test('getRegionOverallRisk retorna o máximo por região', () => {
  const matrix = [
    { region: 'A', disasterType: 'enchente', riskLevel: 'baixo' },
    { region: 'A', disasterType: 'vendaval', riskLevel: 'alto' },
  ];
  const overall = getRegionOverallRisk(matrix, 'A');
  assert.equal(overall.riskLevel, 'alto');
  assert.equal(overall.disasterType, 'vendaval');
  assert.equal(getRegionOverallRisk([], 'A'), null);
});

test('riskRank ordena por gravidade', () => {
  assert.equal(riskRank('baixo'), 0);
  assert.equal(riskRank('critico'), 3);
});

test('buildRegionRisks marca simulação quando fonte é simulada', () => {
  const regions = [
    { id: 'poa', name: 'Porto Alegre', levelMeters: 2.13, trend: 'subindo', source: 'simulação/offline' },
  ];
  const ds = { level: 'simulação', alerts: 'simulação' };
  const matrix = buildRegionRisks(regions, [], regions[0], ds);
  assert.ok(matrix.every(r => r.source === 'simulação/offline'));
});

test('getRisksByRegion filtra por região', () => {
  const matrix = [
    { region: 'A', disasterType: 'enchente', riskLevel: 'baixo' },
    { region: 'B', disasterType: 'enchente', riskLevel: 'alto' },
  ];
  const a = getRisksByRegion(matrix, 'A');
  assert.equal(a.length, 1);
  assert.equal(a[0].region, 'A');
});


test('sem cota da régua, o risco de enchente não é classificado por cota emprestada', () => {
  // thresholds null = régua sem cota publicada (caso das estações da DCRS)
  assert.equal(getFloodRisk(2.13, null).riskLevel, 'desconhecido');
  assert.equal(getDrainageRisk(2.13, 'subindo', null).riskLevel, 'desconhecido');
  assert.equal(getCycloneBombRisk(2.13, 'subindo', [], null).riskLevel, 'desconhecido');
});

test('floodRiskFromAlarm usa o alarme oficial da rede', () => {
  assert.equal(floodRiskFromAlarm(0).riskLevel, 'baixo');
  assert.equal(floodRiskFromAlarm(1).riskLevel, 'critico');
  assert.equal(floodRiskFromAlarm(null).riskLevel, 'desconhecido');
  assert.equal(floodRiskFromAlarm(undefined).riskLevel, 'desconhecido');
});

test('buildRegionRisks classifica pelo alarme quando a régua não tem cota', () => {
  const semAlarme = buildRegionRisks(
    [{ id: 'dcrs', name: 'Barra do Ribeiro', levelMeters: 1.54, trend: 'subindo', thresholds: null, alarmStatus: 0 }],
    [], null, { level: 'Defesa Civil RS' }
  );
  const enchente = semAlarme.find(r => r.disasterType === 'enchente');
  assert.equal(enchente.riskLevel, 'baixo');
  assert.match(enchente.source, /alarme oficial/i);

  const comAlarme = buildRegionRisks(
    [{ id: 'dcrs', name: 'Barra do Ribeiro', levelMeters: 3.9, trend: 'subindo', thresholds: null, alarmStatus: 2 }],
    [], null, { level: 'Defesa Civil RS' }
  );
  assert.equal(comAlarme.find(r => r.disasterType === 'enchente').riskLevel, 'critico');
});

test('risco desconhecido não vence o risco geral da região', () => {
  const matrix = [
    { region: 'A', disasterType: 'enchente', riskLevel: 'desconhecido' },
    { region: 'A', disasterType: 'vendaval', riskLevel: 'moderado' },
  ];
  assert.equal(getRegionOverallRisk(matrix, 'A').riskLevel, 'moderado');

  const soDesconhecido = [{ region: 'B', disasterType: 'enchente', riskLevel: 'desconhecido' }];
  assert.equal(getRegionOverallRisk(soDesconhecido, 'B').riskLevel, 'desconhecido');
});

test('deslizamento usa o índice oficial quando ele existe', () => {
  // Com índice publicado, a dedução pela chuva não manda mais.
  assert.equal(getLandslideRisk('baixo', 0).riskLevel, 'baixo');
  assert.equal(getLandslideRisk('baixo', 1).riskLevel, 'moderado');
  assert.equal(getLandslideRisk('baixo', 2).riskLevel, 'alto');
  assert.equal(getLandslideRisk('baixo', 3).riskLevel, 'critico');
  assert.match(getLandslideRisk('baixo', 2).description, /Defesa Civil/);

  // Sem índice, volta a deduzir — e o texto diz que veio da chuva.
  assert.equal(getLandslideRisk('critico', null).riskLevel, 'alto');
  assert.match(getLandslideRisk('critico', null).description, /[Cc]huva/);
});

test('ciclone bomba pesa a chuva medida, não só o nível do rio', () => {
  const cotas = { atencao: 1.56, inundacao: 2.60, severa: 3.50, critica: 4.50 };
  // Rio baixo, mas 70 mm em 24h: alagamento urbano é risco real.
  const chuvaForte = getCycloneBombRisk(0.8, 'estavel', { rain24h: 70 }, cotas);
  assert.equal(chuvaForte.riskLevel, 'alto');
  assert.match(chuvaForte.description, /70 mm/);

  // Acumulado longo satura o solo mesmo sem pico diário.
  assert.equal(getCycloneBombRisk(0.8, 'estavel', { rain24h: 10, rain72h: 120 }, cotas).riskLevel, 'alto');
  assert.equal(getCycloneBombRisk(0.8, 'estavel', { rain24h: 35 }, cotas).riskLevel, 'moderado');
  // Sem chuva significativa, decide pelo nível como antes.
  assert.equal(getCycloneBombRisk(0.8, 'estavel', { rain24h: 0 }, cotas).riskLevel, 'baixo');
  assert.equal(getCycloneBombRisk(2.7, 'subindo', null, cotas).riskLevel, 'moderado');
});

test('buildRegionRisks marca a origem do risco de deslizamento', () => {
  const comIndice = buildRegionRisks(
    [{ id: 'x', name: 'X', levelMeters: 1.5, trend: 'estavel', thresholds: null, alarmStatus: 0, landslideStatus: 2 }],
    [], null, { level: 'Defesa Civil RS' }
  ).find((r) => r.disasterType === 'deslizamento');
  assert.equal(comIndice.riskLevel, 'alto');
  assert.match(comIndice.source, /índice oficial/i);

  const semIndice = buildRegionRisks(
    [{ id: 'x', name: 'X', levelMeters: 1.5, trend: 'estavel', thresholds: null, alarmStatus: 0 }],
    [], null, { level: 'Defesa Civil RS' }
  ).find((r) => r.disasterType === 'deslizamento');
  assert.match(semIndice.source, /derivado da chuva/i);
});
