export const meta = {
  name: 'refatorar-api-real',
  description: 'Refatora o código de fetching de APIs com dados reais (js/api.js e scripts/collect.js) em subagents paralelos, com verificação final. Mudanças pequenas, seguras e reversíveis.',
};

const phases = [
  { title: 'Implementação' },
  { title: 'Verificação' },
];

// ============================================================
// Phase 1: Implementação (2 agents em paralelo)
// Cada agente analisa, refatora e valida seu respectivo arquivo.
// ============================================================
phase('Implementação');

const [apiResult, collectResult] = await parallel([
  () => agent(`Você é um engenheiro de software refatorando código. No diretório /home/eduardodlima/projetos/guaiba-monitor, refatore js/api.js aplicando APESAS mudanças pequenas, seguras e reversíveis.

LEIA primeiro: js/api.js, js/utils.js, js/config.js, test/*.test.js, data/realtime.json, data/elnino.json, docs/fase1-fontes-e-endpoints.md.

IDENTIFIQUE e aplique as seguintes refatorações:
1. REMOVER codigo morto: ENDPOINTS.dcrsProxy (declarado mas nunca usado em nenhum fetch)
2. EXTRAI fetchJson(url): wrapper de fetchWithRetry que parseia JSON automaticamente, eliminando duplicacao de try/parse em fetchRealtime/fetchElnino
3. IMPROVIR fetchWithRetry: usar try/finally para garantir clearTimeout(timeoutId) sempre (robustez contra abort/erro)
4. DECOUPRAR fetchAll: extrair a logica de merge de alertas simulados vs reais para funcao helper clara (ex: mergeAlerts)
5. ADICIONAR null-check defensivo em fetchLevelGuaiba: verificar rt.level antes de acessar rt.level.levelMeters
6. PRESERVAR todos os exports, assinaturas e comportamentos — npm test + npm run lint devem passar

DEPOIS de editar:
- Rode npm test
- Rode npm run lint
Reporte: arquivos alterados, resumo dos diffs, resultados de teste e lint. Se algo der errado, reverta e tente outro approach.`, { cwd: '/home/eduardodlima/projetos/guaiba-monitor' }),

  () => agent(`Voce eh um engenheiro de software refatorando codigo. No diretorio /home/eduardodlima/projetos/guaiba-monitor, refatore scripts/collect.js aplicando APENAS mudancas pequenas, seguras e reversiveis.

LEIA primeiro: scripts/collect.js, js/elnino.js, test/collect.test.js, .github/workflows/collect.yml, data/elnino.json.

IDENTIFIQUE e aplique as seguintes refatoracoes:
1. ADICIONAR newline final em writeJson: JSON.stringify(data, null, 2) + '\\n'
2. ISOLAR falhas por fonte em main: try/catch individual por coleta (uma falha nao deve bloquear outras) — substituir Promise.all por await sequencial com catch individual
3. ADICIONAR null-check defensivo em collectElNino: verificar parsed.regions e parsed.regions.nino34 antes de acessar .ssta
4. CLARIFICAR collectLevel: manter como stub intencional, comentario explicito de que e por falta de fonte publica
5. PRESERVAR todos os exports e assinaturas — test/collect.test.js (parseDcrsRss) deve continuar passando

DEPOIS de editar:
- Rode npm test
- Rode npm run lint
Reporte: arquivos alterados, resumo dos diffs, resultados de teste e lint. Se algo der errado, reveeta e tente outro approach.`, { cwd: '/home/eduardodlima/projetos/guaiba-monitor' }),
]);

log('=== Resultado api.js ===\n' + (apiResult || 'N/A').toString().slice(0, 1200));
log('=== Resultado collect.js ===\n' + (collectResult || 'N/A').toString().slice(0, 1200));

// ============================================================
// Phase 2: Verificação (1 agent)
// ============================================================
phase('Verificacao');

await agent(`Voce eh um agente de verificacao final. No diretorio /home/eduardodlima/projetos/guaiba-monitor:

1. Rode npm test — todos os testes devem passar
2. Rode npm run lint — sem errors novos
3. Rode git diff --stat para revisar arquivos alterados
4. Rode git diff para revisar o diff completo
5. Confirme que exports publicos de js/api.js e scripts/collect.js permanecem intactos
6. Confirme que ENDPOINTS.dcrsProxy foi removido (sem codigo morto)

Reporte resumo final: PASS/FAIL para testes, lint, exports intactos, sem codigo morto. Se houver falhas, descreva o erro principal.`, { cwd: '/home/eduardodlima/projetos/guaiba-monitor' });
