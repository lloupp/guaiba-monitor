import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEnsoState,
  parseNinoText,
  splitNumber,
  anomalyColor,
  ENSO_THRESHOLD,
} from '../js/elnino.js';

test('ENSO_THRESHOLD é 0.5', () => {
  assert.equal(ENSO_THRESHOLD, 0.5);
});

test('splitNumber divide SST concatenado com SSTA', () => {
  assert.deepEqual(splitNumber('20.6-0.1'), { sst: 20.6, ssta: -0.1 });
  assert.deepEqual(splitNumber('28.3-0.3'), { sst: 28.3, ssta: -0.3 });
  assert.deepEqual(splitNumber('25.4+0.2'), { sst: 25.4, ssta: 0.2 });
  assert.equal(splitNumber('invalido'), null);
});

test('parseNinoText extrai a última semana com todas as regiões', () => {
  const sample = `
 Weekly SST data starts week centered on 2Sept1981
                Nino1+2      Nino3        Nino34        Nino4
 Week          SST SSTA     SST SSTA     SST SSTA     SST SSTA
 02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3
 09SEP1981     20.1-0.6     24.7-0.2     26.5-0.2     28.4-0.2
`;
  const out = parseNinoText(sample);
  assert.ok(out);
  assert.equal(out.week, '09SEP1981');
  assert.equal(out.regions.nino34.sst, 26.5);
  assert.equal(out.regions.nino34.ssta, -0.2);
  assert.equal(out.regions.nino12.sst, 20.1);
});

test('parseNinoText retorna null para entrada inválida/vazia', () => {
  assert.equal(parseNinoText(''), null);
  assert.equal(parseNinoText(null), null);
  assert.equal(parseNinoText('apenas uma linha'), null);
});

test('deriveEnsoState classifica corretamente', () => {
  assert.equal(deriveEnsoState(0.8), 'El Niño');
  assert.equal(deriveEnsoState(0.5), 'El Niño');
  assert.equal(deriveEnsoState(-0.6), 'La Niña');
  assert.equal(deriveEnsoState(-0.5), 'La Niña');
  assert.equal(deriveEnsoState(0.2), 'Neutro');
  assert.equal(deriveEnsoState(-0.3), 'Neutro');
  assert.equal(deriveEnsoState(0), 'Neutro');
  assert.equal(deriveEnsoState(null), 'Neutro');
});

test('anomalyColor é frio (azul) para negativo e quente (vermelho) para positivo', () => {
  assert.match(anomalyColor(-2), /^rgb\(/);
  assert.match(anomalyColor(2), /^rgb\(/);
  // extremo quente deve ter componente R maior que B
  const warm = anomalyColor(2).match(/\d+/g).map(Number);
  assert.ok(warm[0] > warm[2]);
  const cold = anomalyColor(-2).match(/\d+/g).map(Number);
  assert.ok(cold[2] > cold[0]);
});
