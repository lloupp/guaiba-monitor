// tests/test-alerts.js — Testes para sortAlertsBySeverity
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortAlertsBySeverity } from '../js/alerts.js';

describe('sortAlertsBySeverity', () => {
  it('ordena alertas do mais grave para o menos grave', () => {
    const alerts = [
      { severity: 'info', title: 'Info', issuedAt: '2024-01-01' },
      { severity: 'emergencia', title: 'Emergência', issuedAt: '2024-01-02' },
      { severity: 'atencao', title: 'Atenção', issuedAt: '2024-01-03' },
    ];
    const result = sortAlertsBySeverity(alerts);
    assert.strictEqual(result[0].severity, 'emergencia');
    assert.strictEqual(result[1].severity, 'atencao');
    assert.strictEqual(result[2].severity, 'info');
  });

  it('desempata por data (mais recente primeiro)', () => {
    const alerts = [
      { severity: 'info', title: 'A', issuedAt: '2024-01-01' },
      { severity: 'info', title: 'B', issuedAt: '2024-01-03' },
    ];
    const result = sortAlertsBySeverity(alerts);
    assert.strictEqual(result[0].title, 'B');
    assert.strictEqual(result[1].title, 'A');
  });

  it('retorna array vazio para input undefined', () => {
    const result = sortAlertsBySeverity(undefined);
    assert.strictEqual(result.length, 0);
  });

  it('retorna cópia (não muta o array original)', () => {
    const original = [{ severity: 'atencao', title: 'A', issuedAt: '2024-01-01' }];
    const result = sortAlertsBySeverity(original);
    assert.strictEqual(result !== original, true);
  });

  it('ordena corretamente com severidades mistas', () => {
    const alerts = [
      { severity: 'perigo', title: 'Perigo', issuedAt: '2024-01-01' },
      { severity: 'emergencia', title: 'Emergência', issuedAt: '2024-01-02' },
      { severity: 'info', title: 'Info', issuedAt: '2024-01-03' },
      { severity: 'atencao', title: 'Atenção', issuedAt: '2024-01-04' },
    ];
    const result = sortAlertsBySeverity(alerts);
    assert.strictEqual(result[0].severity, 'emergencia');
    assert.strictEqual(result[1].severity, 'perigo');
    assert.strictEqual(result[2].severity, 'atencao');
    assert.strictEqual(result[3].severity, 'info');
  });
});
