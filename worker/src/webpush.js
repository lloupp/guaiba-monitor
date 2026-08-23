// webpush.js — Web Push (RFC 8291 + RFC 8292) só com Web Crypto.
//
// Por que não usar a lib `web-push`: ela depende do módulo `crypto` do Node,
// que não existe no runtime do Cloudflare Worker. Aqui só se usa a Web Crypto
// API, disponível igual no Worker e no Node 18+ — o que também permite testar
// esta implementação sem rede (ver test/webpush.test.js, que decripta o
// resultado com uma biblioteca independente).
//
// Formato: aes128gcm (RFC 8188), com o segredo derivado por ECDH P-256 + HKDF.

const P256 = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };

// === base64url ===

/** @param {ArrayBuffer|Uint8Array} buf @returns {string} */
export function toBase64Url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} str @returns {Uint8Array} */
export function fromBase64Url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Concatena buffers. @param {...Uint8Array} parts @returns {Uint8Array} */
function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);

// === HKDF (RFC 5869) ===

/**
 * @param {Uint8Array} salt @param {Uint8Array} ikm @param {Uint8Array} info
 * @param {number} length — bytes
 * @returns {Promise<Uint8Array>}
 */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

// === Chaves ===

/**
 * Importa a chave pública do cliente (65 bytes, formato uncompressed).
 * @param {Uint8Array} raw
 * @returns {Promise<CryptoKey>}
 */
function importPublicKey(raw) {
  return crypto.subtle.importKey('raw', raw, P256, true, []);
}

/**
 * Importa o par VAPID a partir das chaves base64url geradas pelo web-push.
 * A privada é o `d` (32 bytes); x e y saem da pública (0x04 || x || y).
 * @param {string} publicKey @param {string} privateKey
 * @returns {Promise<CryptoKey>} chave de assinatura ECDSA
 */
export async function importVapidKey(publicKey, privateKey) {
  const pub = fromBase64Url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error('VAPID_PUBLIC_KEY deve ser uma chave P-256 não comprimida (65 bytes)');
  }
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(pub.slice(1, 33)),
    y: toBase64Url(pub.slice(33, 65)),
    d: toBase64Url(fromBase64Url(privateKey)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['sign']);
}

// === VAPID (RFC 8292) ===

/**
 * Cabeçalho Authorization para um endpoint.
 * @param {object} params
 * @param {string} params.endpoint
 * @param {string} params.subject — mailto: ou https:
 * @param {string} params.publicKey — VAPID pública (base64url)
 * @param {CryptoKey} params.signingKey — de importVapidKey
 * @param {number} [params.now]
 * @returns {Promise<string>}
 */
export async function vapidAuthorization({ endpoint, subject, publicKey, signingKey, now = Date.now() }) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  // 12h de validade: o limite do RFC é 24h; metade disso evita problema de
  // relógio adiantado no servidor de push.
  const payload = { aud, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject };

  const signingInput = `${toBase64Url(utf8(JSON.stringify(header)))}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    utf8(signingInput)
  );

  return `vapid t=${signingInput}.${toBase64Url(sig)}, k=${publicKey}`;
}

// === Criptografia do payload (RFC 8291) ===

/**
 * Criptografa o payload para uma subscription.
 * @param {object} params
 * @param {string} params.payload — texto (JSON) a enviar
 * @param {string} params.p256dh — chave pública do cliente (base64url)
 * @param {string} params.auth — segredo de autenticação do cliente (base64url)
 * @param {Uint8Array} [params.salt] — 16 bytes; injetável para testes
 * @param {CryptoKeyPair} [params.serverKeys] — par efêmero; injetável para testes
 * @returns {Promise<Uint8Array>} corpo pronto para o POST
 */
export async function encryptPayload({ payload, p256dh, auth, salt, serverKeys }) {
  const clientPublicRaw = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  const usedSalt = salt || crypto.getRandomValues(new Uint8Array(16));

  const keys = serverKeys || (await crypto.subtle.generateKey(P256, true, ['deriveBits']));
  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));

  // Segredo compartilhado ECDH
  const clientPublicKey = await importPublicKey(clientPublicRaw);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    keys.privateKey,
    256
  );
  const shared = new Uint8Array(sharedBits);

  // IKM: liga o segredo às duas chaves públicas (RFC 8291 §3.3)
  const ikmInfo = concat(utf8('WebPush: info\0'), clientPublicRaw, serverPublicRaw);
  const ikm = await hkdf(authSecret, shared, ikmInfo, 32);

  const cek = await hkdf(usedSalt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(usedSalt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marca o último (e único) registro do fluxo.
  const plaintext = concat(utf8(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext)
  );

  // Cabeçalho aes128gcm: salt(16) | rs(4) | idlen(1) | chave pública do servidor
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(usedSalt, rs, new Uint8Array([serverPublicRaw.length]), serverPublicRaw, ciphertext);
}

// === Envio ===

/**
 * Envia uma notificação para uma subscription.
 *
 * @param {object} subscription — { endpoint, keys: { p256dh, auth } }
 * @param {object|string} payload — vira JSON quando objeto
 * @param {object} vapid — { subject, publicKey, signingKey }
 * @param {object} [opts] — { ttl, urgency, fetchImpl }
 * @returns {Promise<{ok: boolean, status: number, gone: boolean}>}
 *   `gone` = a inscrição não existe mais (404/410) e deve ser apagada.
 */
export async function sendNotification(subscription, payload, vapid, opts = {}) {
  const { endpoint, keys } = subscription;
  const body = await encryptPayload({
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    p256dh: keys.p256dh,
    auth: keys.auth,
  });

  const authorization = await vapidAuthorization({
    endpoint,
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    signingKey: vapid.signingKey,
  });

  const doFetch = opts.fetchImpl || fetch;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // TTL alto: se o telefone está sem rede na enchente, a notificação
      // precisa esperar por ele em vez de ser descartada.
      TTL: String(opts.ttl ?? 12 * 60 * 60),
      Urgency: opts.urgency || 'high',
    },
    body,
  });

  return {
    ok: res.ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  };
}
