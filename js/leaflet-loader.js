// leaflet-loader.js — Carrega o Leaflet só quando ele for realmente aparecer.
//
// O mapa do El Niño é a última seção da página e custa ~150 KB (CSS + JS). No
// <head>, esse peso atrasava justamente quem abriu o app com pressa e rede
// ruim para ver o nível do rio. Aqui ele é buscado quando a seção se aproxima
// da tela — e nunca, se a pessoa não rolar até lá.

const LEAFLET_VERSION = '1.9.4';
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const CSS_INTEGRITY = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const JS_INTEGRITY = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

let carregando = null;

/** Injeta uma tag e resolve quando ela carrega. */
function injetar(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`falha ao carregar ${attrs.href || attrs.src}`));
    document.head.appendChild(el);
  });
}

/**
 * Carrega o Leaflet uma única vez.
 * @returns {Promise<object|null>} o objeto L, ou null se a CDN não respondeu
 */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (carregando) return carregando;

  carregando = (async () => {
    try {
      await Promise.all([
        injetar('link', { rel: 'stylesheet', href: CSS_URL, integrity: CSS_INTEGRITY, crossOrigin: 'anonymous' }),
        injetar('script', { src: JS_URL, integrity: JS_INTEGRITY, crossOrigin: 'anonymous', async: true }),
      ]);
      return window.L || null;
    } catch (err) {
      console.warn('[leaflet]', err.message);
      carregando = null; // permite tentar de novo numa próxima rolagem
      return null;
    }
  })();

  return carregando;
}

/**
 * Chama `aoAparecer` quando o elemento se aproxima da tela.
 * Sem IntersectionObserver (navegador antigo), chama na hora — melhor carregar
 * demais do que deixar alguém sem o mapa.
 * @param {Element} el
 * @param {function} aoAparecer
 * @param {string} [margem] — quanto antes disparar
 */
export function quandoVisivel(el, aoAparecer, margem = '300px') {
  if (!el) return;
  if (!('IntersectionObserver' in window)) {
    aoAparecer();
    return;
  }
  const obs = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (entrada.isIntersecting) {
        obs.disconnect();
        aoAparecer();
      }
    }
  }, { rootMargin: margem });
  obs.observe(el);
}
