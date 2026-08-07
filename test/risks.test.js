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
  assert.equal(THRESHOLDS.atencao, 1.5);
  assert.equal(THRESHOLDS.inundacao, 2.0);
  assert.equal(THRESHOLDS.critica, 3.0);
});

test('getFloodRisk classifica corretamente pelos thresholds', () => {
  assert.equal(getFloodRisk(0.5).riskLevel, 'baixo');
  assert.equal(getFloodRisk(1.6).riskLevel, 'moderado');
  assert.equal(getFloodRisk(2.4).riskLevel, 'moderado');
  assert.equal(getFloodRisk(2.7).riskLevel, 'alto');
  assert.equal(getFloodRisk(3.1).riskLevel, 'critico');
});

test('getDrainageRisk considera nível + tendência', () => {
  assert.equal(getDrainageRisk(2.2, 'estavel').riskLevel, 'moderado');
  assert.equal(getDrainageRisk(2.2, 'subindo').riskLevel, 'moderado');
  assert.equal(getDrainageRisk(1.2, 'estavel').riskLevel, 'baixo');
});

test('getCycloneBombRisk eleva risco em nível subindo', () => {
  assert.equal(getCycloneBombRisk(1.2, 'estavel', []).riskLevel, 'baixo');
  assert.equal(getCycloneBombRisk(2.2, 'subindo', []).riskLevel, 'moderado');
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
