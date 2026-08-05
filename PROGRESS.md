# Guaiba Monitor — Plano de Desenvolvimento Incremental

## Skill de referência: `guaiba-flood-monitor-builder`
TODAS as fases devem seguir a skill `guaiba-flood-monitor-builder` (carregada no cron).

## Status: Fase 1 pendente (pesquisa de fontes)

## Fases

### Fase 1 — Pesquisa de fontes e validação [PENDENTE]
- Testar com curl: endpoint de nível do Guaíba (IPH-UFRGS, CPRM-SACE), alertas INMET, Defesa Civil RS
- Confirmar cota de transbordo oficial atual (CPRM/Defesa Civil RS)
- Documentar endpoints funcionantes em docs/
- Atualizar skill com o que funcionar
- Commit: `docs: Fase 1 — pesquisa de fontes`

### Fase 2 — Layout e Dashboard [PENDENTE]
- Header com título e indicador de nível atual
- Cards por região (POA, Canoas, Guaíba, região)
- Segmentos de cota e legenda de cores
- CSS responsivo, tema escuro
- Commit: `feat: layout e dashboard`

### Fase 3 — Coleta de dados (API) [PENDENTE]
- Implementar js/api.js: fetch nível + alertas
- Fallback: dados de exemplo quando offline
- Política de retry e timeout
- Commit: `feat: coleta de dados`

### Fase 4 — Nível e Gráfico [PENDENTE]
- Nível atual + cota de referência
- Gráfico de linha/área em Canvas com linha de transbordo
- Histórico persistido em localStorage
- Commit: `feat: nível e gráfico`

### Fase 5 — Riscos por região e tipo [PENDENTE]
- Matriz de risco: ciclone bomba, vendaval, granizo, deslizamento, enchente
- Cards por região com nível de risco
- Texto de orientação correspondente
- Commit: `feat: riscos por região`

### Fase 6 — Alertas e notificações [PENDENTE]
- Lista de alertas ativos (INMET/Defesa Civil)
- Severidade colorida (amarelo/laranja/vermelho)
- Aviso toast quando nível cruza limiar do usuário
- Commit: `feat: alertas e notificações`

### Fase 7 — Polimento [PENDENTE]
- Animações, responsividade mobile
- Checklist de preparação
- Validação
- Commit: `feat: polimento`

### Fase 8 — Deploy GitHub Pages [PENDENTE]
- Configurar Pages, verificar, atualizar README
- Commit: `deploy: GitHub Pages`

## Regras do cron
1. Ler PROGRESS.md
2. Implementar fase completa
3. Testar (node -c, HTML, JSON válido, curl endpoints)
4. Commit + push
5. Atualizar status
6. Reportar
