import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLevelStatus,
  getLevelStatusInfo,
  getLevelScale,
  severityRank,
  sortAlertsBySeverity,
  formatAlertForDisplay,
  formatAlertSeverity,
} from '../js/alerts.js';
import { escapeHtml, formatMeters } from '../js/utils.js';

test('getLevelStatus classifica o nível do rio', () => {
  // Cotas oficiais pós-2024: atencao 1.56 / inundacao 2.60 / severa 3.50 / critica 4.50
  assert.equal(getLevelStatus(0.5), 'normal');
  assert.equal(getLevelStatus(1.50), 'normal');      // < atencao (1.56)
  assert.equal(getLevelStatus(1.6), 'atencao');
  assert.equal(getLevelStatus(2.6), 'inundacao');
  assert.equal(getLevelStatus(3.0), 'inundacao');    // entre inundação (2.60) e severa (3.50)
  assert.equal(getLevelStatus(3.5), 'severa');
  assert.equal(getLevelStatus(4.5), 'critica');
});

test('getLevelStatusInfo expõe label e classe de badge', () => {
  const info = getLevelStatusInfo(3.2);
  assert.equal(info.status, 'inundacao');
  assert.equal(info.label, 'INUNDAÇÃO');
  assert.equal(info.css, 'inundacao');
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

test('getLevelScale deriva as faixas dos thresholds', () => {
  const scale = getLevelScale({ atencao: 1.56, inundacao: 2.60, severa: 3.50, critica: 4.50 });
  assert.equal(scale.length, 5);
  assert.deepEqual(scale.map(s => s.status), ['normal', 'atencao', 'inundacao', 'severa', 'critica']);
  assert.deepEqual(scale.map(s => s.min), [0, 1.56, 2.60, 3.50, 4.50]);
  assert.deepEqual(scale.map(s => s.max), [1.56, 2.60, 3.50, 4.50, null]);
});

test('a escala padrão é coerente com a classificação do nível', () => {
  // Legenda e badge do nível precisam concordar: o início de cada faixa
  // tem de ser classificado exatamente com o status daquela faixa.
  for (const seg of getLevelScale()) {
    assert.equal(getLevelStatus(seg.min), seg.status, `min ${seg.min} → ${seg.status}`);
  }
});
