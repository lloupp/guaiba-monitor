// risks.js — Riscos por região e tipo de desastre
// Fase 5: Riscos por região e tipo
//
// Deriva a matriz de risco (região × tipo de desastre) a partir do nível do
// rio (stations), alertas INMET/Defesa Civil e previsão do tempo.
// Quando sem dados reais (simulação/offline), os riscos são derivados dos
// dados de exemplo — sempre marcados como "simulação/offline".

import { THRESHOLDS } from './config.js';
import { sampleLevels, sampleAlerts } from './api.js';

// === Tipos de desastre monitorados ===
const DISASTER_TYPES = {
  enchente: {
    label: 'Enchente',
    icon: '🌊',
    shortLabel: 'Ench',
  },
  ciclone_bomba: {
    label: "Ciclone Bomba d'Água",
    icon: '🌀',
    shortLabel: 'CicB',
  },
  vendaval: {
    label: 'Vendaval',
    icon: '💨',
    shortLabel: 'Vdv',
  },
  granizo: {
    label: 'Granizo',
    icon: '🧊',
    shortLabel: 'Grn',
  },
  deslizamento: {
    label: 'Deslizamento',
    icon: '⛰️',
    shortLabel: 'Dsl',
  },
  alagamento: {
    label: 'Alagamento',
    icon: '🌧️',
    shortLabel: 'Alg',
  },
  ressaca: {
    label: 'Ressaca',
    icon: '〰️',
    shortLabel: 'Rss',
  },
};

// Ordem de exibição (enchente sempre primeiro — risco principal do Guaíba)
const DISASTER_ORDER = ['enchente', 'ciclone_bomba', 'alagamento', 'vendaval', 'granizo', 'deslizamento', 'ressaca'];

// Thresholds (fonte única: config.js ← data/ref-levels.json)

// Níveis de risco
const RISK_LEVELS = {
  baixo:    { label: 'Baixo',    css: 'normal',   badgeClass: 'badge-normal',   icon: '🟢' },
  moderado: { label: 'Moderado', css: 'atencao',  badgeClass: 'badge-atencao', icon: '🟡' },
  alto:     { label: 'Alto',     css: 'severa',   badgeClass: 'badge-severa',  icon: '🟠' },
  critico:  { label: 'Crítico',  css: 'critica',  badgeClass: 'badge-critica', icon: '🔴' },
};

// Ranks para comparação (maior = mais grave)
const RISK_RANK = { baixo: 0, moderado: 1, alto: 2, critico: 3 };

// Mapeamento de tipos de alerta (INMET/DCRS) → tipo de desastre
const ALERT_TYPE_MAP = {
  'Vendaval': 'vendaval',
  'Granizo': 'granizo',
  'Chuva': 'ciclone_bomba',
  'Chuva forte': 'ciclone_bomba',
  'Chuva muito forte': 'ciclone_bomba',
  'Enchente': 'enchente',
  'Inundação': 'enchente',
  'Ressaca': 'ressaca',
  'Deslizamento': 'deslizamento',
  'Alagamento': 'alagamento',
};

// Mapeamento de severidade de alerta → nível de risco RegionRisk
const ALERT_SEVERITY_MAP = {
  'info': 'baixo',
  'atencao': 'moderado',
  'perigo': 'alto',
  'emergencia': 'critico',
};

// === Funções de derivação de risco ===

/**
 * Classifica risco de enchente a partir do nível do rio.
 * @param {number} levelMeters
 * @returns {{riskLevel: string, alertCode: string, description: string}}
 */
function getFloodRisk(levelMeters) {
  const l = parseFloat(levelMeters);
  if (l >= THRESHOLDS.critica) return { riskLevel: 'critico', alertCode: 'vermelho', description: 'Transbordo grave — evacuação emergencial nas áreas de baixa elevação às margens do Guaíba.' };
  if (l >= THRESHOLDS.severa) return { riskLevel: 'alto', alertCode: 'laranja', description: 'Nível severo — inundações avançadas em áreas ribeirinhas. Evite aproximação de margens.' };
  if (l >= THRESHOLDS.inundacao) return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Acima da cota de inundação — áreas baixas em risco. Monitore atualizações.' };
  if (l >= THRESHOLDS.atencao) return { riskLevel: 'moderado', alertCode: 'amarelo', description: 'Próximo ao limite de atenção — vigiar evolução do nível.' };
  return { riskLevel: 'baixo', alertCode: 'verde', description: 'Nível dentro do normal — monitoramento rotineiro.' };
}

/**
 * Deriva risco de alagamento urbano a partir do nível do rio + tendência.
 * @param {number} levelMeters
 * @param {string} trend
 * @returns {{riskLevel: string, alertCode: string, description: string}}
 */
function getDrainageRisk(levelMeters, trend) {
  const l = parseFloat(levelMeters);
  if (l >= THRESHOLDS.critica) return { riskLevel: 'critico', alertCode: 'vermelho', description: 'Alagamentos generalizados — drenos submersos. Evite transitar em vias alagadas.' };
  if (l >= THRESHOLDS.severa) return { riskLevel: 'alto', alertCode: 'laranja', description: 'Risco de alagamento urbano — drenos em capacidade reduzida.' };
  if (l >= THRESHOLDS.inundacao && trend === 'subindo') return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Possível alagamento em pontos baixos com nível subindo.' };
  if (l >= THRESHOLDS.inundacao) return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Possível alagamento em pontos baixos.' };
  if (l >= THRESHOLDS.atencao) return { riskLevel: 'baixo', alertCode: 'amarelo', description: 'Atenção a pontos de alagamento em fortes chuvas.' };
  return { riskLevel: 'baixo', alertCode: 'verde', description: 'Drenagem normal.' };
}

/**
 * Deriva risco de ciclone bomba (sobrecarga simultânea de mar + chuva)
 * a partir de nível + tendência + forecast de chuva.
 * @param {number} levelMeters
 * @param {string} trend
 * @param {Array} weather — previsão do tempo
 * @returns {{riskLevel: string, alertCode: string, description: string}}
 */
function getCycloneBombRisk(levelMeters, trend, _weather) {
  const l = parseFloat(levelMeters);
  // Se já acima de atenção e subindo → risco moderado
  if (l >= THRESHOLDS.inundacao && trend === 'subindo') {
    return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Risco de ciclone bomba — mar + chuva sobrecarregam drenos simultaneamente.' };
  }
  if (l >= THRESHOLDS.critica) {
    return { riskLevel: 'alto', alertCode: 'vermelho', description: 'Alto risco de ciclone bomba — nível crítico multiplica efeito de chuva.' };
  }
  if (l >= THRESHOLDS.atencao) {
    return { riskLevel: 'baixo', alertCode: 'amarelo', description: 'Risco reduzido de ciclone bomba — monitorar chuva forte.' };
  }
  return { riskLevel: 'baixo', alertCode: 'verde', description: 'Sem risco significativo de ciclone bomba.' };
}

/**
 * Deriva risco de ressaca (oscilação do nível) a partir de tendência + nível.
 * @param {number} levelMeters
 * @param {string} trend
 * @returns {{riskLevel: string, alertCode: string, description: string}}
 */
function getWorryRisk(levelMeters, trend) {
  const l = parseFloat(levelMeters);
  if (l >= THRESHOLDS.critica) {
    return { riskLevel: 'alto', alertCode: 'vermelho', description: 'Ressaca severa no nível crítico — evite áreas ribeirinhas.' };
  }
  if (l >= THRESHOLDS.severa && (trend === 'subindo' || trend === 'descendo')) {
    return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Oscilação do nível (ressaca) em nível severo — vigiar variações rápidas.' };
  }
  if (l >= THRESHOLDS.inundacao) {
    return { riskLevel: 'moderado', alertCode: 'amarelo', description: 'Possível ressaca com nível acima da cota de inundação.' };
  }
  if (trend === 'subindo' || trend === 'descendo') {
    return { riskLevel: 'baixo', alertCode: 'amarelo', description: 'Variação leve do nível — condições normais de ressaca.' };
  }
  return { riskLevel: 'baixo', alertCode: 'verde', description: 'Sem risco de ressaca.' };
}

/**
 * Deriva risco de deslizamento a partir de risco de chuva (ciclone bomba).
 * Encostas de Serra gaúcha e áreas serranas são vulneráveis.
 * @param {string} rainRiskLevel — riskLevel derivado para ciclone_bomba
 * @returns {{riskLevel: string, alertCode: string, description: string}}
 */
function getLandslideRisk(rainRiskLevel) {
  if (rainRiskLevel === 'critico') return { riskLevel: 'alto', alertCode: 'vermelho', description: 'Alto risco de deslizamento em áreas serranas. Evite encostas.' };
  if (rainRiskLevel === 'alto') return { riskLevel: 'moderado', alertCode: 'laranja', description: 'Risco moderado de deslizamento — monitorar áreas de encosta.' };
  if (rainRiskLevel === 'moderado') return { riskLevel: 'baixo', alertCode: 'amarelo', description: 'Vigiar possibilidade de deslizamento em áreas de encosta.' };
  return { riskLevel: 'baixo', alertCode: 'verde', description: 'Sem risco significativo de deslizamento.' };
}

// === Alertas → risco ===

/**
 * Verifica se um alerta atinge uma região específica.
 * @param {Alert} alert
 * @param {string} regionName
 * @returns {boolean}
 */
function alertAffectsRegion(alert, regionName) {
  if (!alert.regions || alert.regions.length === 0) return true; // alerta regional/genérico
  return alert.regions.some(r =>
    r.toLowerCase().includes(regionName.toLowerCase()) ||
    regionName.toLowerCase().includes(r.toLowerCase())
  );
}

/**
 * Extrai o risco de um tipo de desastre específico a partir de alertas ativos.
 * Se houver um alerta correspondente, mapeia a severidade.
 * Caso contrário, retorna null (o risco deve ser derivado de outra fonte).
 * @param {Alert[]} alerts
 * @param {string} regionName
 * @param {string} disasterKey — chave de DISASTER_TYPES
 * @returns {{riskLevel: string, alertCode: string, source: string}|null}
 */
function getRiskFromAlerts(alerts, regionName, disasterKey) {
  const matching = alerts.filter(a => {
    const mapped = ALERT_TYPE_MAP[a.type];
    return mapped === disasterKey && alertAffectsRegion(a, regionName);
  });
  if (matching.length === 0) return null;
  // Usa a maior severidade entre os alertas compatíveis
  const worst = matching.reduce((best, a) => {
    const sr = ALERT_SEVERITY_MAP[a.severity] || 'baixo';
    if (RISK_RANK[sr] > RISK_RANK[best.riskLevel]) return { riskLevel: sr, alertCode: sr === 'baixo' ? 'verde' : sr === 'moderado' ? 'amarelo' : sr === 'alto' ? 'laranja' : 'vermelho', source: a.source };
    return best;
  }, { riskLevel: 'baixo', alertCode: 'verde', source: matching[0].source });
  return worst;
}

// === Orientações por tipo de desastre + nível de risco ===

const ORIENTATIONS = {
  enchente: {
    baixo: 'Nível dentro do normal. Monitore o nível do rio periodicamente.',
    moderado: 'Acima de atenção. Evite áreas ribeirinhas e baixas. Monitore atualizações.',
    alto: 'Nível severo. Evacue áreas de baixa elevação às margens do rio. Não tente atravessar vias alagadas.',
    critico: 'TRANSBORDO GRAVE. Evacuação emergencial imediata nas áreas de risco às margens. Afastar-se de corredores d\'água.',
  },
  ciclone_bomba: {
    baixo: 'Sem condições para ciclone bomba. Mantenha-se informado sobre previsão de chuva.',
    moderado: 'Risco de sobrecarga de drenos com chuva forte + mar. Evite vias baixas em caso de chuva.',
    alto: 'Alta probabilidade de alagamento urbano acentuado. Evite sair em áreas de risco e monitore pontos de drenagem.',
    critico: 'Ciclone bomba em andamento. Evite transeuntes em vias alagadas. Busque abrigo em local elevado.',
  },
  alagamento: {
    baixo: 'Drenagem normal. Atenção a pontos de alagamento em fortes chuvas.',
    moderado: 'Possível alagamento em pontos baixos. Evite atravessar vias com água parada.',
    alto: 'Alagamentos em andamento. Não tente atravessar vias alagadas a pé ou em veículos.',
    critico: 'Alagamento generalizado. Evacue áreas baixas. Nunca tente atravessar água parada em vias.',
  },
  vendaval: {
    baixo: 'Sem vendaval significativo. Mantenha-se informado.',
    moderado: 'Vendaval previsto. Amarre objetos soltos e evite áreas expostas.',
    alto: 'Vendaval forte. Abrigue-se em ambiente fechado e evite sair.',
    critico: 'Vendaval severo. Permaneça em ambiente fechado e afaste-se de janelas.',
  },
  granizo: {
    baixo: 'Sem granizo reportado.',
    moderado: 'Granizo possível. Proteja veículos e evite áreas abertas.',
    alto: 'Granizo forte. Abrigue-se em local fechado e evite janelas.',
    critico: 'Granizo severo. Abrigo imediato. Risco de escorregamento em telhados.',
  },
  deslizamento: {
    baixo: 'Sem risco significativo de deslizamento.',
    moderado: 'Vigiar possibilidade de deslizamento em áreas de encosta após fortes chuvas.',
    alto: 'Alto risco de deslizamento em áreas serranas. Evite encostas e vale encostas.',
    critico: 'Risco crítico de deslizamento. Evacue áreas de encosta imediatamente.',
  },
  ressaca: {
    baixo: 'Sem risco de ressaca significativo.',
    moderado: 'Oscilação do nível possível. Monitore variações rápidas do nível do rio.',
    alto: 'Ressaca em andamento com nível elevado. Evite áreas ribeirinhas.',
    critico: 'Ressaca severa. Evite totalmente a proximidade de margens.',
  },
};

/**
 * Retorna texto de orientação para um tipo de desastre + nível de risco.
 * @param {string} disasterKey
 * @param {string} riskLevel
 * @returns {string}
 */
function getOrientation(disasterKey, riskLevel) {
  const byType = ORIENTATIONS[disasterKey];
  if (!byType) return 'Monitore a situação.';
  return byType[riskLevel] || byType.baixo;
}

/**
 * Formata o nível de risco para exibição (badge).
 * @param {string} riskLevel
 * @returns {{label: string, css: string, badgeClass: string, icon: string}}
 */
function formatRiskLevel(riskLevel) {
  return RISK_LEVELS[riskLevel] || RISK_LEVELS.baixo;
}

/**
 * Retorna o rank numérico de um nível de risco.
 * @param {string} riskLevel
 * @returns {number}
 */
function riskRank(riskLevel) {
  return RISK_RANK[riskLevel] || 0;
}

// === Builder da matriz de riscos ===

/**
 * Constrói a matriz de risco (RegiãoRisk[]) a partir do estado da aplicação.
 * Cada combinação de região × tipo de desastre é uma entrada.
 *
 * @param {Array} regions — do state.regions (level, trend, name, id, source)
 * @param {Array} alerts — do state.alerts
 * @param {Array} weather — do state.weather
 * @param {object} [level] — leitura principal (state.level)
 * @param {object} [dataSources] — para marcar simulação/offline
 * @returns {RegionRisk[]}
 */
function buildRegionRisks(regions, alerts, weather, level, dataSources) {
  const isSimulacao = dataSources && (
    dataSources.level?.includes('simulação') ||
    dataSources.alerts?.includes('simulação')
  );
  const now = new Date().toISOString();

  const matrix = [];

  regions.forEach(region => {
    const regionName = region.name;

    // 1. Enchente (do nível do rio)
    const flood = getFloodRisk(region.levelMeters);
    matrix.push({
      id: `risco-${region.id}-enchente`,
      region: regionName,
      disasterType: 'enchente',
      riskLevel: flood.riskLevel,
      description: flood.description,
      alertCode: flood.alertCode,
      updatedAt: now,
      source: isSimulacao ? 'simulação/offline' : (dataSources?.level || 'derivado'),
    });

    // 2. Alagamento (do nível + tendência)
    const drainage = getDrainageRisk(region.levelMeters, region.trend);
    matrix.push({
      id: `risco-${region.id}-alagamento`,
      region: regionName,
      disasterType: 'alagamento',
      riskLevel: drainage.riskLevel,
      description: drainage.description,
      alertCode: drainage.alertCode,
      updatedAt: now,
      source: isSimulacao ? 'simulação/offline' : 'derivado do nível',
    });

    // 3. Ciclone bomba (do nível + tendência + forecast)
    const ciclo = getCycloneBombRisk(region.levelMeters, region.trend, weather);
    matrix.push({
      id: `risco-${region.id}-ciclone_bomba`,
      region: regionName,
      disasterType: 'ciclone_bomba',
      riskLevel: ciclo.riskLevel,
      description: ciclo.description,
      alertCode: ciclo.alertCode,
      updatedAt: now,
      source: isSimulacao ? 'simulação/offline' : 'derivado (nível + forecast INMET)',
    });

    // 4. Ressaca (do nível + tendência)
    const ressaca = getWorryRisk(region.levelMeters, region.trend);
    matrix.push({
      id: `risco-${region.id}-ressaca`,
      region: regionName,
      disasterType: 'ressaca',
      riskLevel: ressaca.riskLevel,
      description: ressaca.description,
      alertCode: ressaca.alertCode,
      updatedAt: now,
      source: isSimulacao ? 'simulação/offline' : 'derivado do nível',
    });

    // 5. Vendaval (de alertas ativos)
    const windRisk = getRiskFromAlerts(alerts, regionName, 'vendaval');
    if (windRisk) {
      matrix.push({
        id: `risco-${region.id}-vendaval`,
        region: regionName,
        disasterType: 'vendaval',
        riskLevel: windRisk.riskLevel,
        description: getOrientation('vendaval', windRisk.riskLevel),
        alertCode: windRisk.alertCode,
        updatedAt: now,
        source: windRisk.source,
      });
    } else {
      matrix.push({
        id: `risco-${region.id}-vendaval`,
        region: regionName,
        disasterType: 'vendaval',
        riskLevel: 'baixo',
        description: 'Sem alerta de vendaval ativo.',
        alertCode: 'verde',
        updatedAt: now,
        source: isSimulacao ? 'simulação/offline' : 'INMET (sem alerta ativo)',
      });
    }

    // 6. Granizo (de alertas ativos)
    const hailRisk = getRiskFromAlerts(alerts, regionName, 'granizo');
    if (hailRisk) {
      matrix.push({
        id: `risco-${region.id}-granizo`,
        region: regionName,
        disasterType: 'granizo',
        riskLevel: hailRisk.riskLevel,
        description: getOrientation('granizo', hailRisk.riskLevel),
        alertCode: hailRisk.alertCode,
        updatedAt: now,
        source: hailRisk.source,
      });
    } else {
      matrix.push({
        id: `risco-${region.id}-granizo`,
        region: regionName,
        disasterType: 'granizo',
        riskLevel: 'baixo',
        description: 'Sem alerta de granizo ativo.',
        alertCode: 'verde',
        updatedAt: now,
        source: isSimulacao ? 'simulação/offline' : 'INMET (sem alerta ativo)',
      });
    }

    // 7. Deslizamento (derivado do risco de chuva/ciclone bomba)
    const landslide = getLandslideRisk(ciclo.riskLevel);
    matrix.push({
      id: `risco-${region.id}-deslizamento`,
      region: regionName,
      disasterType: 'deslizamento',
      riskLevel: landslide.riskLevel,
      description: landslide.description,
      alertCode: landslide.alertCode,
      updatedAt: now,
      source: isSimulacao ? 'simulação/offline' : 'derivado do risco de chuva',
    });
  });

  return matrix;
}

/**
 * Dados de exemplo (SIMULAÇÃO/OFFLINE) — sempre marcados como tal.
 * Reutiliza os mesmos sample levels/alerts/weather do api.js e deriva a
 * matriz pela mesma função buildRegionRisks (fonte única de derivação),
 * garantindo consistência entre simulação e dados reais.
 * @returns {RegionRisk[]}
 */
function sampleRegionRisks() {
  const levels = sampleLevels();
  const alerts = sampleAlerts();
  const regions = levels.map(l => ({
    id: l.station,
    name: l.location,
    levelMeters: l.levelMeters,
    trend: l.trend,
    source: l.source,
  }));
  const ds = { level: 'simulação', alerts: 'simulação' };
  return buildRegionRisks(regions, alerts, [], levels[0], ds);
}

/**
 * Calcula o risco geral (máximo) de uma região a partir da matriz.
 * @param {RegionRisk[]} matrix
 * @param {string} regionName
 * @returns {{riskLevel: string, disasterType: string}|null}
 */
function getRegionOverallRisk(matrix, regionName) {
  const regionRisks = matrix.filter(r => r.region === regionName);
  if (regionRisks.length === 0) return null;
  const worst = regionRisks.reduce((best, r) => {
    if (riskRank(r.riskLevel) > riskRank(best.riskLevel)) return r;
    return best;
  }, regionRisks[0]);
  return { riskLevel: worst.riskLevel, disasterType: worst.disasterType };
}

/**
 * Filtra a matriz por região (para cards/visão resumida).
 * @param {RegionRisk[]} matrix
 * @param {string} regionName
 * @returns {RegionRisk[]}
 */
function getRisksByRegion(matrix, regionName) {
  return matrix.filter(r => r.region === regionName);
}

// === Exports ===

export {
  DISASTER_TYPES,
  DISASTER_ORDER,
  THRESHOLDS,
  RISK_LEVELS,
  RISK_RANK,
  getFloodRisk,
  getDrainageRisk,
  getCycloneBombRisk,
  getWorryRisk,
  getLandslideRisk,
  getRiskFromAlerts,
  alertAffectsRegion,
  getOrientation,
  formatRiskLevel,
  riskRank,
  buildRegionRisks,
  sampleRegionRisks,
  getRegionOverallRisk,
  getRisksByRegion,
};
