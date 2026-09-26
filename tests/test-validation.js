// tests/test-validation.js — Testes para validation.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRealtimeData, validateElninoData, validateAlertsData, validateAll } from '../js/validation.js';

describe('validateRealtimeData', () => {
  it('retorna válido para dados reais de nível com estrutura completa', () => {
    const data = {
      level: { levelMeters: 2.5, trend: 'subindo', stationCode: '4314902' },
      alerts: [{ id: '1', title: 'Teste', severity: 'info' }]
    };
    const result = validateRealtimeData(data);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('rejeita dados nulos', () => {
    const result = validateRealtimeData(null);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('rejeita nível sem levelMeters', () => {
    const data = { level: { trend: 'subindo', stationCode: '4314902' }, alerts: [] };
    const result = validateRealtimeData(data);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita nível sem trend', () => {
    const data = { level: { levelMeters: 2.5, stationCode: '4314902' }, alerts: [] };
    const result = validateRealtimeData(data);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita alerts não-array', () => {
    const data = { level: { levelMeters: 2.5, trend: 'subindo', stationCode: '4314902' }, alerts: 'teste' };
    const result = validateRealtimeData(data);
    assert.strictEqual(result.valid, false);
  });
});

describe('validateElninoData', () => {
  it('retorna válido para dados El Niño com nino34', () => {
    const data = { regions: { nino34: { sst: 27.5, ssta: 0.5 } } };
    const result = validateElninoData(data);
    assert.strictEqual(result.valid, true);
  });

  it('rejeita dados nulos', () => {
    const result = validateElninoData(null);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita sem regions', () => {
    const data = { regions: {} };
    const result = validateElninoData(data);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita sem nino34', () => {
    const data = { regions: { nino34: {} } };
    const result = validateElninoData(data);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita sem sst ou ssta', () => {
    const data = { regions: { nino34: { sst: 27.5 } } };
    const result = validateElninoData(data);
    assert.strictEqual(result.valid, false);
  });
});

describe('validateAlertsData', () => {
  it('retorna válido para array de alertas com severity e title', () => {
    const data = [{ severity: 'info', title: 'Teste' }];
    const result = validateAlertsData(data);
    assert.strictEqual(result.valid, true);
  });

  it('rejeita não-array', () => {
    const result = validateAlertsData('teste');
    assert.strictEqual(result.valid, false);
  });

  it('rejeita alerta sem severity', () => {
    const data = [{ title: 'Teste' }];
    const result = validateAlertsData(data);
    assert.strictEqual(result.valid, false);
  });

  it('rejeita alerta sem title', () => {
    const data = [{ severity: 'info' }];
    const result = validateAlertsData(data);
    assert.strictEqual(result.valid, false);
  });
});

describe('validateAll', () => {
  it('retorna válido para dados completos', () => {
    const data = {
      level: { levelMeters: 2.5, trend: 'subindo', stationCode: '4314902' },
      alerts: [{ severity: 'info', title: 'Teste' }],
      regions: { nino34: { sst: 27.5, ssta: 0.5 } }
    };
    const result = validateAll(data);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });
});
