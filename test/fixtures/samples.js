// samples.js — Dados de exemplo APENAS PARA TESTES.
//
// Estes dados NÃO são importados pelo app: desde a Fase 0, o Guaiba Monitor
// nunca exibe leitura inventada. Quando não há dado real, a interface mostra
// estado vazio com o motivo. Ver js/api.js.
//
// Ficam aqui só para alimentar os testes de derivação de risco e ordenação.

/** @returns {object} leitura de nível de exemplo */
export function sampleLevelReading(station, location, levelMeters, trend) {
  return {
    id: `sample-${station}`,
    station,
    location,
    levelMeters: parseFloat(levelMeters.toFixed(2)),
    trend,
    recordedAt: '2026-08-18T22:00:00.000Z',
    source: 'simulação/offline',
  };
}

/** @returns {object[]} três estações de exemplo */
export function sampleLevels() {
  return [
    sampleLevelReading('poa-cais-maua', 'Porto Alegre', 2.13, 'subindo'),
    sampleLevelReading('canoas', 'Canoas', 1.82, 'estavel'),
    sampleLevelReading('guaiba-cidade', 'Guaíba', 1.45, 'descendo'),
  ];
}

/** @returns {object[]} alertas de exemplo */
export function sampleAlerts() {
  return [
    {
      id: 'sample-alert-1',
      type: 'Vendaval',
      severity: 'perigo',
      title: 'Vendaval forte no RS',
      message: 'Rajadas de vento entre 40-60 km/h.',
      regions: ['Porto Alegre', 'Canoas', 'Guaíba'],
      issuedAt: '2026-08-18T22:00:00.000Z',
      source: 'simulação/offline',
    },
    {
      id: 'sample-alert-2',
      type: 'Chuva',
      severity: 'atencao',
      title: 'Chuva forte',
      message: 'Sistema frontal pode elevar o nível do rio nas próximas 24h.',
      regions: ['Porto Alegre'],
      issuedAt: '2026-08-18T22:00:00.000Z',
      source: 'simulação/offline',
    },
  ];
}

/**
 * Matriz de risco derivada dos exemplos acima, pela mesma função de produção
 * (buildRegionRisks), para os testes de cobertura da matriz.
 * @param {function} buildRegionRisks — importado do js/risks.js pelo teste
 * @returns {object[]}
 */
export function sampleRegionRisks(buildRegionRisks) {
  const levels = sampleLevels();
  const alerts = sampleAlerts();
  const regions = levels.map((l) => ({
    id: l.station,
    name: l.location,
    levelMeters: l.levelMeters,
    trend: l.trend,
    source: l.source,
  }));
  return buildRegionRisks(regions, alerts, levels[0], {
    level: 'simulação',
    alerts: 'simulação',
  });
}
