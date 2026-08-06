# Guaiba Monitor — Plano de Desenvolvimento Incremental

## Skill de referência: `guaiba-flood-monitor-builder`
TODAS as fases devem seguir a skill `guaiba-flood-monitor-builder` (carregada no cron).

## Status: Fase 3 concluída — próxima fase pendente (Fase 4)

## Fases

### Fase 1 — Pesquisa de fontes e validação [CONCLUÍDO — 2026-08-05]
- Testar com curl: endpoint de nível do Guaíba (IPH-UFRGS, CPRM-SACE), alertas INMET, Defesa Civil RS  ✓
- Confirmar cota de transbordo oficial atual (CPRM/Defesa Civil RS)                          — não confirmada via API JSON; mantidos valores aproximados em ref-levels.json
- Documentar endpoints funcionantes em docs/fase1-fontes-e-endpoints.md                       ✓
- Atualizar skill com o que funcionar                                                          — api.js com estrutura e endpoints confirmados
- Commit: `docs: Fase 1 — pesquisa de fontes`                                                  ✓

**Resultado**:
- INMET `/avisos/ativos` ✅ e `/previsao/{geocode}` ✅ — funcionam, sem auth, CORS aberto
- CPRM SACE HTML ✅ mas sem API JSON pública; sem endpoint direto de nível
- Defesa Civil RS HTML ✅ — uchar scraping via proxy; sem JSON
- IPH-UFRGS telemetria ❌ — 404
- Nível do Guaíba: sem endpoint JSON público direto. Usar dados de exemplo marcados como "simulação/offline" para MVP.

### Fase 2 — Layout e Dashboard [CONCLUÍDO — 2026-08-05]
- Header com título e indicador de nível atual
- Cards por região (POA, Canoas, Guaíba, região)
- Segmentos de cota e legenda de cores
- CSS responsivo, tema escuro
- Commit: `feat: layout e dashboard`

### Fase 3 — Coleta de dados (API) [CONCLUÍDO — 2026-08-06]
|- Implementar js/api.js: fetch nível + alertas ✓
|- Fallback: dados de exemplo quando offline ✓
|- Política de retry e timeout ✓
|- Commit: `feat: coleta de dados (api.js + integração no app.js)` ✓

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
