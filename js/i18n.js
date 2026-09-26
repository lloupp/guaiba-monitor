// @ts-check

/**
 * Internationalization module for Guaiba Monitor.
 * Provides translations for pt-BR and en locales.
 */

export const translations = {
  'pt-BR': {
    appTitle: 'Guaiba Monitor',
    appSubtitle: 'Nível do rio Guaíba e riscos de desastres — Porto Alegre, Canoas e Guaíba',
    levelIndicator: 'Indicador de Nível',
    regionCards: 'Risco por Região',
    alertSection: 'Alertas Ativos',
    checklistTitle: 'Checklist de Preparação — Enchente',
    checklistProgress: (checked, total) => `${checked}/${total} itens concluídos`,
    loaderText: 'Carregando Guaiba Monitor...',
    noAlerts: 'Nenhum alerta ativo no momento.',
    offlineBanner: '⚠️ MODO SIMULAÇÃO — Dados de exemplo. Fonte real indisponível.',
    themeToggle: 'Alternar tema claro/escuro',
    notifications: 'Ativar notificações',
    stationSelector: 'Estação:',
  },
  'en': {
    appTitle: 'Guaiba Monitor',
    appSubtitle: 'Guaíba river level and disaster risks — Porto Alegre, Canoas and Guaíba',
    levelIndicator: 'Level Indicator',
    regionCards: 'Risk by Region',
    alertSection: 'Active Alerts',
    checklistTitle: 'Flood Preparation Checklist',
    checklistProgress: (checked, total) => `${checked}/${total} items completed`,
    loaderText: 'Loading Guaiba Monitor...',
    noAlerts: 'No active alerts at the moment.',
    offlineBanner: '⚠️ SIMULATION MODE — Example data. Real source unavailable.',
    themeToggle: 'Toggle light/dark theme',
    notifications: 'Enable notifications',
    stationSelector: 'Station:',
  },
};

/**
 * Translates a key to the specified language.
 * Falls back to pt-BR if the key or lang is not found.
 *
 * @param {string} key - The translation key.
 * @param {string} [lang='pt-BR'] - The target language code.
 * @returns {string} The translated string, or the key itself if not found.
 */
export function t(key, lang = 'pt-BR') {
  const locale = translations[lang] || translations['pt-BR'];
  if (locale && locale[key] !== undefined) {
    return locale[key];
  }
  // Fallback to pt-BR
  const ptBR = translations['pt-BR'];
  if (ptBR && ptBR[key] !== undefined) {
    return ptBR[key];
  }
  // Key not found at all, return the key itself
  return key;
}

export default { translations, t };
