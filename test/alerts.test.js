import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLevelStatus,
  getLevelStatusInfo,
  severityRank,
  sortAlertsBySeverity,
  formatAlertForDisplay,
  formatAlertSeverity,
} from '../js/alerts.js';
import { escapeHtml, formatMeters } from '../js/utils.js';

test('getLevelStatus classifica o nível do rio', () => {
  assert.equal(getLevelStatus(0.5), 'normal');
  assert.equal(getLevelStatus(1.5), 'atencao');
  assert.equal(getLevelStatus(2.0), 'inundacao');
  assert.equal(getLevelStatus(2.5), 'severa');
  assert.equal(getLevelStatus(3.0), 'critica');
});

test('getLevelStatusInfo expõe label e classe de badge', () => {
  const info = getLevelStatusInfo(3.2);
  assert.equal(info.status, 'critica');
  assert.equal(info.label, 'CRÍTICA');
  assert.equal(info.css, 'critica');
});

test('severityRank ordena severidade', () => {
  assert.equal(severityRank('info'), 0);
  assert.equal(severityRank('atencao'), 1);
  assert.equal(severityRank('perigo'), 2);
  assert.equal(severityRank('emergencia'), 3);
});

test('sortAlertsBySeverity coloca os mais graves primeiro', () => {
  const alerts = [
    { id: 'a', severity: 'atencao', issuedAt: '2026-08-01T00:00:00Z' },
    { id: 'b', severity: 'emergencia', issuedAt: '2026-08-01T00:00:00Z' },
    { id: 'c', severity: 'perigo', issuedAt: '2026-08-01T00:00:00Z' },
  ];
  const sorted = sortAlertsBySeverity(alerts);
  assert.deepEqual(sorted.map(a => a.id), ['b', 'c', 'a']);
});

test('sortAlertsBySeverity desempata por data (mais recente primeiro)', () => {
  const alerts = [
    { id: 'a', severity: 'perigo', issuedAt: '2026-08-01T00:00:00Z' },
    { id: 'b', severity: 'perigo', issuedAt: '2026-08-05T00:00:00Z' },
  ];
  assert.deepEqual(sortAlertsBySeverity(alerts).map(a => a.id), ['b', 'a']);
});

test('formatAlertForDisplay preenche valores padrão', () => {
  const d = formatAlertForDisplay({});
  assert.equal(d.type, 'Alerta');
  assert.equal(d.severity, 'info');
  assert.equal(d.title, 'Aviso');
  assert.deepEqual(d.regions, []);
  assert.deepEqual(d.instructions, []);
});

test('formatAlertSeverity cai para info em severidade desconhecida', () => {
  assert.equal(formatAlertSeverity('desconhecido').css, 'info');
  assert.equal(formatAlertSeverity('perigo').label, 'Perigo');
});

test('escapeHtml escapa caracteres perigosos', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("o'brien"), 'o&#39;brien');
  assert.equal(escapeHtml(null), '');
});

test('formatMeters formata com unidade', () => {
  assert.equal(formatMeters(2), '2.00 m');
});
