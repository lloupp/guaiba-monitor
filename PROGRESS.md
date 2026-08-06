# Guaiba Monitor — Plano de Desenvolvimento Incremental

## Skill de referência: `guaiba-flood-monitor-builder`
TODAS as fases devem seguir a skill `guaiba-flood-monitor-builder` (carregada no cron).

## Status: Fase 6 concluída — próxima fase pendente (Fase 7)

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

### Fase 4 — Nível e Gráfico [CONCLUÍDO — 2026-08-06]
|- Nível atual + cota de referência ✓ (já existia em app.js, integrado ao gráfico)
|- Gráfico de linha/área em Canvas com linha de transbordo ✓
|- Histórico persistido em localStorage (gm_levels_history) ✓
|- Deduplicação por estação + minuto, cap de 50 leituras por estação ✓
|- Re-render responsivo (resize + toggle de tema) ✓
|- Commit: `feat: nível e gráfico (Canvas + histórico localStorage)` ✓

### Fase 5 — Riscos por região e tipo [CONCLUÍDO — 2026-08-06]
||- Matriz de risco: ciclone bomba, vendaval, granizo, deslizamento, enchente ✓
||- Cards por região com nível de risco geral (badge derivado da matriz) ✓
||- Texto de orientação correspondente (por região + tipo de desastre) ✓
||- Matriz de risco (região × tipo de desastre) em tabela com badges coloridos ✓
||- Derivação automática: enchente/alagamento/ressaca do nível do rio; vendaval/granizo de alertas INMET; deslizamento do risco de chuva ✓
||- Dados sample (simulação/offline) e derivação real — mesma arquitetura da Fase 3 ✓
||- Commit: `feat: riscos por região e tipo (Fase 5) — matriz de risco região×desastre + orientações` ✓

### Fase 6 — Alertas e notificações [CONCLUÍDO — 2026-08-06]
||- Lista de alertas ativos (INMET/Defesa Civil) ✓
||- Severidade colorida (amarelo/laranja/vermelho) ✓
||- Aviso toast quando nível cruza limiar do usuário ✓
||- Ordenação por gravidade (mais grave primeiro) ✓
||- Estado vazio quando não há alertas ✓
||- Limiar configurável pelo usuário (input + localStorage gm_settings.alertThreshold) ✓
||- Toast de escalada de risco (normal→atenção→inundação→severa→crítica) ✓
||- Toast de sucesso ao ajustar limiar ✓
||- Commit: `feat: alertas e notificações (Fase 6) — lista de alertas + toasts de threshold` ✓

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
