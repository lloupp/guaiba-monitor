import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import {
  encryptPayload,
  vapidAuthorization,
  importVapidKey,
  toBase64Url,
  fromBase64Url,
} from '../worker/src/webpush.js';

// Bibliotecas de referência, independentes desta implementação. Se o que o
// Worker cifra puder ser decifrado por elas, o formato está certo — é a
// verificação possível sem enviar push de verdade.
const require = createRequire(import.meta.url);
const ece = require('../push-tool/node_modules/http_ece');
const jws = require('../push-tool/node_modules/jws');

/** Cria uma subscription de mentira com chaves P-256 reais. */
function fakeSubscription() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    p256dh: toBase64Url(new Uint8Array(raw)),
    auth: toBase64Url(new Uint8Array(16).map(() => Math.floor(Math.random() * 256))),
    privateKey,
    publicKeyRaw: raw,
  };
}

test('payload cifrado é decifrável pela biblioteca de referência (aes128gcm)', async () => {
  const sub = fakeSubscription();
  const mensagem = JSON.stringify({ title: '🚨 Alarme de inundação', body: 'Barra do Ribeiro, 3.90 m' });

  const body = await encryptPayload({ payload: mensagem, p256dh: sub.p256dh, auth: sub.auth });

  // O http_ece precisa da chave privada do "cliente" em formato jwk
  const jwk = sub.privateKey.export({ format: 'jwk' });
  const decifrado = ece.decrypt(Buffer.from(body), {
    version: 'aes128gcm',
    privateKey: {
      getPublicKey: () => Buffer.from(sub.publicKeyRaw),
      computeSecret: (other) => {
        const { diffieHellman } = require('node:crypto');
        return diffieHellman({
          privateKey: sub.privateKey,
          publicKey: createPublicKey({
            key: { kty: 'EC', crv: 'P-256', x: toBase64Url(other.subarray(1, 33)), y: toBase64Url(other.subarray(33, 65)) },
            format: 'jwk',
          }),
        });
      },
    },
    dh: Buffer.from(sub.publicKeyRaw),
    authSecret: Buffer.from(fromBase64Url(sub.auth)),
  });

  assert.equal(decifrado.toString('utf8'), mensagem, 'o texto decifrado tem de ser idêntico ao enviado');
  assert.ok(jwk.d, 'chave de teste válida');
});

test('cabeçalho do corpo segue o formato aes128gcm', async () => {
  const sub = fakeSubscription();
  const salt = new Uint8Array(16).fill(7);
  const body = await encryptPayload({ payload: 'oi', p256dh: sub.p256dh, auth: sub.auth, salt });

  assert.deepEqual([...body.slice(0, 16)], [...salt], 'começa com o salt de 16 bytes');
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  assert.equal(rs, 4096, 'record size');
  assert.equal(body[20], 65, 'tamanho da chave pública efêmera');
  assert.equal(body[21], 4, 'chave em formato não comprimido');
});

test('mesma mensagem gera corpos diferentes (salt e chave efêmera novos)', async () => {
  const sub = fakeSubscription();
  const a = await encryptPayload({ payload: 'x', p256dh: sub.p256dh, auth: sub.auth });
  const b = await encryptPayload({ payload: 'x', p256dh: sub.p256dh, auth: sub.auth });
  assert.notDeepEqual([...a], [...b]);
});

test('JWT do VAPID é válido e assinado pela chave', async () => {
  // Par VAPID no mesmo formato que o web-push gera
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  const jwk = privateKey.export({ format: 'jwk' });
  const vapidPublic = toBase64Url(new Uint8Array(pubRaw));
  const vapidPrivate = jwk.d;

  const signingKey = await importVapidKey(vapidPublic, vapidPrivate);
  const header = await vapidAuthorization({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    subject: 'mailto:contato@exemplo.org',
    publicKey: vapidPublic,
    signingKey,
    now: Date.parse('2026-08-22T12:00:00Z'),
  });

  assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const token = header.slice('vapid t='.length).split(', k=')[0];

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.aud, 'https://fcm.googleapis.com', 'audience é a origem do endpoint');
  assert.equal(payload.sub, 'mailto:contato@exemplo.org');
  assert.equal(payload.exp, Math.floor(Date.parse('2026-08-22T12:00:00Z') / 1000) + 12 * 3600);

  // verificação da assinatura pela biblioteca independente
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(jws.verify(token, 'ES256', pem), true, 'assinatura ES256 válida');
});

test('chave VAPID pública em formato errado é recusada na hora', async () => {
  await assert.rejects(
    () => importVapidKey(toBase64Url(new Uint8Array(10)), toBase64Url(new Uint8Array(32))),
    /65 bytes/
  );
});
