import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareShelters, isShelterUsable, VALIDADE_DIAS } from '../js/shelters.js';

const AGORA = Date.parse('2026-08-23T12:00:00Z');
const diasAtras = (n) => new Date(AGORA - n * 86_400_000).toISOString().slice(0, 10);

const abrigo = (over = {}) => ({
  name: 'Ginásio Municipal',
  address: 'Rua X, 123',
  latitude: -30.03,
  longitude: -51.23,
  source: 'Defesa Civil RS',
  verifiedAt: diasAtras(3),
  ...over,
});

test('abrigo sem procedência é descartado', () => {
  assert.equal(isShelterUsable(abrigo()), true);
  assert.equal(isShelterUsable(abrigo({ source: undefined })), false, 'sem fonte, não entra');
  assert.equal(isShelterUsable(abrigo({ verifiedAt: undefined })), false, 'sem data de verificação, não entra');
  assert.equal(isShelterUsable(abrigo({ verifiedAt: 'ontem' })), false, 'data ilegível não vale');
  assert.equal(isShelterUsable(abrigo({ name: '' })), false);
  assert.equal(isShelterUsable(abrigo({ address: undefined, latitude: undefined, longitude: undefined })), false);
  assert.equal(isShelterUsable(null), false);
});

test('item sem procedência não contamina a lista exibida', () => {
  const r = prepareShelters({
    shelters: [abrigo(), abrigo({ name: 'Sem fonte', source: undefined })],
  }, null, AGORA);
  assert.equal(r.shelters.length, 1);
  assert.equal(r.descartados, 1);
  assert.equal(r.shelters[0].name, 'Ginásio Municipal');
});

test('informação velha aparece marcada, não some', () => {
  // Sumir esconderia o único abrigo conhecido; marcar deixa a pessoa decidir.
  const r = prepareShelters({
    shelters: [abrigo({ verifiedAt: diasAtras(VALIDADE_DIAS + 5) })],
  }, null, AGORA);
  assert.equal(r.shelters.length, 1);
  assert.equal(r.shelters[0].desatualizado, true);
  assert.equal(r.shelters[0].diasDesdeVerificacao, VALIDADE_DIAS + 5);
});

test('com localização, o mais próximo vem primeiro', () => {
  const perto = abrigo({ name: 'Perto', latitude: -30.04, longitude: -51.23 });
  const longe = abrigo({ name: 'Longe', latitude: -29.0, longitude: -51.23 });
  const r = prepareShelters({ shelters: [longe, perto] }, { latitude: -30.03, longitude: -51.23 }, AGORA);
  assert.deepEqual(r.shelters.map((s) => s.name), ['Perto', 'Longe']);
  assert.ok(r.shelters[0].distanciaKm < r.shelters[1].distanciaKm);
});

test('sem localização, ordena por nome', () => {
  const r = prepareShelters({
    shelters: [abrigo({ name: 'Zeta' }), abrigo({ name: 'Alfa' })],
  }, null, AGORA);
  assert.deepEqual(r.shelters.map((s) => s.name), ['Alfa', 'Zeta']);
});

test('arquivo ausente ou vazio não quebra nem inventa', () => {
  for (const entrada of [null, undefined, {}, { shelters: [] }, { shelters: 'nada disso' }]) {
    const r = prepareShelters(entrada, null, AGORA);
    assert.deepEqual(r.shelters, []);
    assert.equal(r.descartados, 0);
  }
});

test('o arquivo do projeto está vazio e válido (nenhum abrigo inventado)', () => {
  // Guarda contra alguém "preencher para testar" e o exemplo ir para produção.
  const arquivo = JSON.parse(readFileSync(new URL('../data/shelters.json', import.meta.url), 'utf8'));
  const r = prepareShelters(arquivo, null, AGORA);
  assert.deepEqual(r.shelters, [], 'sem fonte viva, o arquivo tem de continuar vazio');
  assert.ok(arquivo._leia.includes('199'), 'o arquivo explica o que o app faz enquanto isso');
});
