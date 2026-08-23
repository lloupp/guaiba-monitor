// push.js — Inscrição em Web Push (lado do navegador).
//
// O envio é do Worker (worker/src/index.js); aqui só se inscreve, cancela e
// guarda a preferência. Sem data/push-config.json, o app segue funcionando com
// aviso local (toast + notificação com o app aberto) — o push é um extra, não
// um requisito.
//
// O que sai deste aparelho: o endpoint de push que o navegador gerou, as
// chaves dessa inscrição e o código da estação escolhida. Localização, não.

import { saveToStorage, loadFromStorage } from './utils.js';

// Promessa em cache (não o valor): evita várias buscas simultâneas do mesmo
// arquivo quando a interface consulta a configuração em pontos diferentes.
let configPromise = null;

/** O navegador suporta Web Push? */
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Configuração do servidor de push (data/push-config.json).
 * Ausente = push desligado no projeto; a interface se adapta.
 * @returns {Promise<object|null>}
 */
export function getPushConfig() {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const res = await fetch('data/push-config.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = await res.json();
      return cfg && cfg.vapidPublicKey && cfg.subscribeUrl ? cfg : null;
    } catch {
      return null;
    }
  })();
  return configPromise;
}

/** base64url → Uint8Array (formato exigido por applicationServerKey). */
function urlBase64ToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Inscrição ativa neste navegador, se houver. */
export async function currentSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Já está recebendo push? */
export async function isSubscribed() {
  const sub = await currentSubscription();
  return Boolean(sub) && Notification.permission === 'granted';
}

/**
 * Inscreve este aparelho para receber avisos da estação escolhida.
 * @param {object} contexto — { stationCode, basin, places }
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function subscribe(contexto = {}) {
  if (!isPushSupported()) return { ok: false, reason: 'sem-suporte' };

  const cfg = await getPushConfig();
  if (!cfg) return { ok: false, reason: 'sem-servidor' };

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return { ok: false, reason: permissao };

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    // Sem isso o navegador recusa: só aceitamos push que a gente mesmo assina.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
  });

  const res = await fetch(cfg.subscribeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      stationCode: contexto.stationCode || 'geral',
      basin: contexto.basin || null,
      places: contexto.places || [],
    }),
  });

  if (!res.ok) {
    // Não deixa uma inscrição órfã no navegador se o servidor não a guardou.
    await sub.unsubscribe().catch(() => {});
    return { ok: false, reason: 'servidor-recusou' };
  }

  saveToStorage('push.station', contexto.stationCode || 'geral');
  saveToStorage('push.enabled', true);
  return { ok: true };
}

/**
 * Cancela o recebimento e pede ao servidor para apagar a inscrição.
 * @returns {Promise<boolean>}
 */
export async function unsubscribe() {
  const sub = await currentSubscription();
  saveToStorage('push.enabled', false);
  if (!sub) return true;

  const cfg = await getPushConfig();
  if (cfg && cfg.unsubscribeUrl) {
    // Melhor esforço: se o servidor não responder, a inscrição some do
    // aparelho de qualquer forma e expira sozinha no servidor.
    await fetch(cfg.unsubscribeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
  }

  return sub.unsubscribe();
}

/**
 * Reinscreve quando a pessoa troca de estação — senão continuaria recebendo
 * avisos de onde não está mais.
 * @param {object} contexto
 * @returns {Promise<boolean>} true se reinscreveu
 */
export async function updateStation(contexto) {
  if (!(await isSubscribed())) return false;
  if (loadFromStorage('push.station', null) === contexto.stationCode) return false;
  await unsubscribe();
  const res = await subscribe(contexto);
  return res.ok;
}
