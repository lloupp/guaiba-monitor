import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFloodRisk,
  getDrainageRisk,
  getCycloneBombRisk,
  getRegionOverallRisk,
  getRisksByRegion,
  riskRank,
  sampleRegionRisks,
  buildRegionRisks,
  DISASTER_ORDER,
} from '../js/risks.js';
import { THRESHOLDS } from '../js/config.js';

test('THRESHOLDS vem de config.js (fonte única) com padrões offline', () => {
  // Cotas oficiais pós-2024 (Gasômetro) — ver js/config.js / data/ref-levels.json
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

test('sampleRegionRisks cobre todas as regiões e tipos de desastre, marcadas simulação', () => {
  const matrix = sampleRegionRisks();
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
  const matrix = buildRegionRisks(regions, [], [], regions[0], ds);
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
