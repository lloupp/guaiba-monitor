import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riseRatePerHour, statusMyLevel, formatarDuracao, textoParaCompartilhar } from '../js/my-level.js';

const t = (horasAtras, levelMeters) => ({
  levelMeters,
  recordedAt: new Date(Date.parse('2026-08-22T12:00:00Z') - horasAtras * 3_600_000).toISOString(),
});

test('riseRatePerHour mede a subida na janela recente', () => {
  // 20 cm em 4 h = 5 cm/h
  const readings = [t(4, 1.0), t(2, 1.1), t(0, 1.2)];
  assert.equal(Math.round(riseRatePerHour(readings) * 1000) / 1000, 0.05);
});

test('riseRatePerHour ignora o que está fora da janela', () => {
  // a queda de ontem não pode contar como tendência de agora
  const readings = [t(48, 5.0), t(3, 1.0), t(0, 1.15)];
  const taxa = riseRatePerHour(readings, 6);
  assert.ok(taxa > 0, 'só a janela recente conta');
  assert.equal(Math.round(taxa * 100) / 100, 0.05);
});

test('riseRatePerHour devolve null sem dados suficientes', () => {
  assert.equal(riseRatePerHour([]), null);
  assert.equal(riseRatePerHour([t(0, 1)]), null);
  assert.equal(riseRatePerHour(null), null);
  // duas leituras no mesmo instante não dão taxa
  assert.equal(riseRatePerHour([t(0, 1), t(0, 2)]), null);
});

test('statusMyLevel: água ainda abaixo e subindo estima o tempo', () => {
  const s = statusMyLevel(1.20, 1.70, 0.05); // faltam 50 cm a 5 cm/h → 10 h
  assert.equal(s.alcancado, false);
  assert.equal(s.faltamCm, 50);
  assert.equal(s.subindo, true);
  assert.equal(Math.round(s.horas), 10);
  assert.match(s.texto, /50 cm/);
  assert.match(s.texto, /estimativa/i, 'a incerteza precisa estar dita');
});

test('statusMyLevel: parado não inventa previsão', () => {
  const s = statusMyLevel(1.20, 1.70, 0);
  assert.equal(s.horas, null);
  assert.match(s.texto, /não está subindo/i);
  assert.doesNotMatch(s.texto, /horas?\b/i);
});

test('statusMyLevel: água já passou manda sair', () => {
  const s = statusMyLevel(1.85, 1.70, 0.05);
  assert.equal(s.alcancado, true);
  assert.match(s.texto, /15 cm/);
  assert.match(s.texto, /saia agora/i);
});

test('formatarDuracao fala como gente', () => {
  assert.equal(formatarDuracao(0.5), '30 minutos');
  assert.equal(formatarDuracao(3), '3 horas');
  assert.equal(formatarDuracao(3.5), '3h30');
  assert.equal(formatarDuracao(48), '2 dias');
  assert.equal(formatarDuracao(-1), 'pouco tempo');
});

test('texto de compartilhamento traz nível, fonte e telefone', () => {
  const texto = textoParaCompartilhar({
    estacao: 'Barra do Ribeiro',
    nivel: 2.35,
    quando: 'hoje 14:20',
    status: statusMyLevel(2.35, 2.60, 0.05),
    url: 'https://exemplo/app',
  });
  assert.match(texto, /Barra do Ribeiro: 2\.35 m/);
  assert.match(texto, /25 cm/);
  assert.match(texto, /Defesa Civil RS/);
  assert.match(texto, /199/);
  assert.match(texto, /https:\/\/exemplo\/app/);
});
