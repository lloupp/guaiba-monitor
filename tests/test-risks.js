// tests/test-risks.js — Testes para getRegionOverallRisk
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRegionOverallRisk } from '../js/risks.js';

describe('getRegionOverallRisk', () => {
  it('retorna null para matriz vazia', () => {
    const result = getRegionOverallRisk([], 'Porto Alegre');
    assert.strictEqual(result, null);
  });

  it('retorna risco para região encontrada', () => {
    const matrix = [
      { region: 'Porto Alegre', disasterType: 'enchente', riskLevel: 'alto' },
      { region: 'Porto Alegre', disasterType: 'alagamento', riskLevel: 'baixo' },
    ];
    const result = getRegionOverallRisk(matrix, 'Porto Alegre');
    assert.strictEqual(result.riskLevel, 'alto');
    assert.strictEqual(result.disasterType, 'enchente');
  });

  it('retorna o pior risco (maior rank) da região', () => {
    const matrix = [
      { region: 'Canoas', disasterType: 'enchente', riskLevel: 'critico' },
      { region: 'Canoas', disasterType: 'vendaval', riskLevel: 'baixo' },
    ];
    const result = getRegionOverallRisk(matrix, 'Canoas');
    assert.strictEqual(result.riskLevel, 'critico');
    assert.strictEqual(result.disasterType, 'enchente');
  });

  it('retorna null para região inexistente na matriz', () => {
    const matrix = [
      { region: 'Porto Alegre', disasterType: 'enchente', riskLevel: 'baixo' },
    ];
    const result = getRegionOverallRisk(matrix, 'Guaíba');
    assert.strictEqual(result, null);
  });
});
