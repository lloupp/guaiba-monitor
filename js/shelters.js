// shelters.js — Abrigos e pontos de apoio.
//
// REGRA DO PROJETO: o app não inventa abrigo. Cada ponto exibido carrega de
// onde veio e quando foi verificado, e o que não tiver isso é descartado na
// carga — mandar alguém para um abrigo que não existe mais, na noite de uma
// enchente, é pior do que não mostrar nada.
//
// Enquanto não há fonte viva (ver README, seção "Abrigos"), data/shelters.json
// fica vazio e a seção não aparece: no lugar, a orientação que funciona sempre
// — ligar 199 e perguntar.

import { haversineKm } from './utils.js';

// Depois disso, a informação é velha demais para mandar alguém até lá sem
// confirmar por telefone.
export const VALIDADE_DIAS = 30;

/**
 * Um abrigo só é exibível se disser o que é, onde fica, de onde veio a
 * informação e quando ela foi conferida.
 * @param {object} item
 * @returns {boolean}
 */
export function isShelterUsable(item) {
  if (!item || typeof item !== 'object') return false;
  const temIdentidade = Boolean(item.name && (item.address || (item.latitude != null && item.longitude != null)));
  const temProcedencia = Boolean(item.source && item.verifiedAt);
  if (!temIdentidade || !temProcedencia) return false;
  const quando = Date.parse(item.verifiedAt);
  return !Number.isNaN(quando);
}

/**
 * Dias desde a última verificação do ponto.
 * @param {object} item
 * @param {number} [now]
 * @returns {number}
 */
export function diasDesdeVerificacao(item, now = Date.now()) {
  return Math.floor((now - Date.parse(item.verifiedAt)) / 86_400_000);
}

/**
 * Carrega e prepara os abrigos exibíveis.
 *
 * @param {object|null} arquivo — conteúdo de data/shelters.json
 * @param {object} [posicao] — { latitude, longitude } para ordenar por distância
 * @param {number} [now]
 * @returns {{shelters: object[], descartados: number, fonte: string|null}}
 */
export function prepareShelters(arquivo, posicao = null, now = Date.now()) {
  const lista = Array.isArray(arquivo?.shelters) ? arquivo.shelters : [];
  const usaveis = lista.filter(isShelterUsable);

  const preparados = usaveis.map((item) => {
    const dias = diasDesdeVerificacao(item, now);
    const distanciaKm = posicao && item.latitude != null && item.longitude != null
      ? haversineKm(posicao.latitude, posicao.longitude, item.latitude, item.longitude)
      : null;
    return {
      ...item,
      diasDesdeVerificacao: dias,
      // Não some da lista por estar velho — a pessoa decide, sabendo a data.
      desatualizado: dias > VALIDADE_DIAS,
      distanciaKm,
    };
  });

  preparados.sort((a, b) => {
    if (a.distanciaKm != null && b.distanciaKm != null) return a.distanciaKm - b.distanciaKm;
    if (a.distanciaKm != null) return -1;
    if (b.distanciaKm != null) return 1;
    return String(a.name).localeCompare(String(b.name), 'pt-BR');
  });

  return {
    shelters: preparados,
    descartados: lista.length - usaveis.length,
    fonte: arquivo?.source || null,
  };
}
