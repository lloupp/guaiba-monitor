// validation.js — Funções de validação de dados

/**
 * Valida os dados de nível em tempo real.
 * Verifica a estrutura de `data.level` e `data.alerts`.
 * @param {object|null|undefined} data — dados a validar
 * @returns {{valid: boolean, errors: string[]}} resultado da validação
 */
export function validateRealtimeData(data) {
  const errors = [];

  if (data == null) {
    return { valid: false, errors: ['Dados são nulos ou indefinidos'] };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Dados devem ser um objeto'] };
  }

  // --- Validação de data.level ---
  if (!data.level || typeof data.level !== 'object' || Array.isArray(data.level)) {
    errors.push('data.level é obrigatório e deve ser um objeto');
  } else {
    if (typeof data.level.levelMeters !== 'number') {
      errors.push('data.level.levelMeters é obrigatório e deve ser um número');
    }
    if (typeof data.level.trend !== 'string') {
      errors.push('data.level.trend é obrigatório e deve ser uma string');
    }
    if (typeof data.level.stationCode !== 'string' && typeof data.level.stationCode !== 'number') {
      errors.push('data.level.stationCode é obrigatório e deve ser uma string ou número');
    }
  }

  // --- Validação de data.alerts ---
  if (!Array.isArray(data.alerts)) {
    errors.push('data.alerts é obrigatório e deve ser um array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida os dados de El Niño.
 * Verifica a estrutura de `data.regions` e `data.regions.nino34`.
 * @param {object|null|undefined} data — dados a validar
 * @returns {{valid: boolean, errors: string[]}} resultado da validação
 */
export function validateElninoData(data) {
  const errors = [];

  if (data == null) {
    return { valid: false, errors: ['Dados são nulos ou indefinidos'] };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    errors.push('Dados devem ser um objeto');
  }

  // --- Validação de data.regions ---
  if (!data.regions || typeof data.regions !== 'object' || Array.isArray(data.regions)) {
    errors.push('data.regions é obrigatório e deve ser um objeto ou array');
  } else {
    if (!data.regions.nino34 || typeof data.regions.nino34 !== 'object' || Array.isArray(data.regions.nino34)) {
      errors.push('data.regions.nino34 é obrigatório e deve ser um objeto');
    } else {
      if (typeof data.regions.nino34.sst !== 'number') {
        errors.push('data.regions.nino34.sst é obrigatório e deve ser um número');
      }
      if (typeof data.regions.nino34.ssta !== 'number') {
        errors.push('data.regions.nino34.ssta é obrigatório e deve ser um número');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida os dados de alertas.
 * Verifica que `data` é um array e cada item possui `severity` e `title`.
 * @param {Array|null|undefined} data — dados a validar
 * @returns {{valid: boolean, errors: string[]}} resultado da validação
 */
export function validateAlertsData(data) {
  const errors = [];

  if (data == null) {
    return { valid: false, errors: ['Dados são nulos ou indefinidos'] };
  }

  if (!Array.isArray(data)) {
    return { valid: false, errors: ['Dados devem ser um array'] };
  }

  data.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`data[${index}] é obrigatório e deve ser um objeto`);
      return;
    }
    if (!item.severity || typeof item.severity !== 'string') {
      errors.push(`data[${index}].severity é obrigatório e deve ser uma string`);
    }
    if (!item.title || typeof item.title !== 'string') {
      errors.push(`data[${index}].title é obrigatório e deve ser uma string`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Executa todas as validações e retorna um resultado combinado.
 * @param {object} data — objeto contendo level, elnino e alerts
 * @returns {{valid: boolean, results: {realtime: {valid: boolean, errors: string[]}, elnino: {valid: boolean, errors: string[]}, alerts: {valid: boolean, errors: string[]}}, errors: string[]}}
 */
export function validateAll(data) {
  const realtimeResult = validateRealtimeData(data);
  const elninoResult = validateElninoData(data);
  const alertsResult = validateAlertsData(data.alerts || []);

  const allErrors = [
    ...realtimeResult.errors,
    ...elninoResult.errors,
    ...alertsResult.errors,
  ];

  return {
    valid: allErrors.length === 0,
    results: {
      realtime: realtimeResult,
      elnino: elninoResult,
      alerts: alertsResult,
    },
    errors: allErrors,
  };
}
