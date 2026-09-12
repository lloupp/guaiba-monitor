# Auditoria Hermes — guaiba-monitor

Gerado em: `2026-09-06 12:01:35`

## Escopo

- **Não alterei código-fonte nem arquivos de configuração.**
- Arquivo criado/atualizado por pedido do Eduardo: `HERMES_AUDIT.md`.
- Testes executados apenas quando havia comando/estrutura detectável, com timeout curto e sem instalar dependências do projeto.

## Resumo

- Tipo detectado: **Node/JavaScript app**
- Arquivos analisados: **58**
- Tamanho aproximado analisado: **0.52 MB**

## Linguagens / tipos de arquivo

- JavaScript: 33
- JSON: 11
- Outro: 7
- Markdown: 4
- HTML: 1
- TOML: 1
- CSS: 1

## Arquivos principais vistos

- `.eslintrc.json`
- `.gitignore`
- `.nojekyll`
- `.pi/workflows/refatorar-api-real.js`
- `.playwright-mcp/console-2026-08-23T16-58-56-699Z.log`
- `PROGRESS.md`
- `README.md`
- `css/style.css`
- `data/elnino.json`
- `data/history.json`
- `data/push-config.json`
- `data/realtime.json`
- `data/ref-levels.json`
- `data/shelters.json`
- `data/stations.json`
- `docs/fase1-fontes-e-endpoints.md`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `icons/icon-maskable-512.png`
- `index.html`
- `js/alerts.js`
- `js/api.js`
- `js/app.js`
- `js/config.js`
- `js/elnino.js`
- `js/events.js`
- `js/leaflet-loader.js`
- `js/levels.js`
- `js/my-level.js`
- `js/push.js`
- `js/risks.js`
- `js/shelters.js`
- `js/sources.js`
- `js/utils.js`
- `manifest.json`
- `package-lock.json`
- `package.json`
- `push-tool/.env`
- `scripts/check-sources.js`
- `scripts/collect.js`
- … mais 18 arquivo(s)

## Estado Git

- Comando: `git status --short --branch`
- Exit code: `0`

```text
## feat/fase0-dados-honestos
?? .pi/
```

## Resultado dos testes / validações

### ✅ OK
- Comando: `npm test -- --watch=false`
- Exit code: `0`
- Tempo: `1.08s`

```text

> guaiba-monitor@1.0.0 test
> node scripts/stamp-sw.js --check && node --test 'test/*.test.js' --watch=false

sw.js já está em va6b7261ebd
TAP version 13
# Subtest: getLevelStatus classifica o nível do rio
ok 1 - getLevelStatus classifica o nível do rio
  ---
  duration_ms: 1.985845
  type: 'test'
  ...
# Subtest: getLevelStatusInfo expõe label e classe de badge
ok 2 - getLevelStatusInfo expõe label e classe de badge
  ---
  duration_ms: 0.4582
  type: 'test'
  ...
# Subtest: severityRank ordena severidade
ok 3 - severityRank ordena severidade
  ---
  duration_ms: 0.285146
  type: 'test'
  ...
# Subtest: sortAlertsBySeverity coloca os mais graves primeiro
ok 4 - sortAlertsBySeverity coloca os mais graves primeiro
  ---
  duration_ms: 1.533148
  type: 'test'
  ...
# Subtest: sortAlertsBySeverity desempata por data (mais recente primeiro)
ok 5 - sortAlertsBySeverity desempata por data (mais recente primeiro)
  ---
  duration_ms: 0.409834
  type: 'test'
  ...
# Subtest: formatAlertForDisplay preenche valores padrão
ok 6 - formatAlertForDisplay preenche valores padrão
  ---
  duration_ms: 0.820049
  type: 'test'
  ...
# Subtest: formatAlertSeverity cai para info em severidade desconhecida
ok 7 - formatAlertSeverity cai para info em severidade desconhecida
  ---
  duration_ms: 0.261856
  type: 'test'
  ...
# Subtest: escapeHtml escapa caracteres perigosos
ok 8 - escapeHtml escapa caracteres perigosos
  ---
  duration_ms: 0.340276
  type: 'test'
  ...
# Subtest: formatMeters formata com unidade
ok 9 - formatMeters formata com unidade
  ---
  duration_ms: 0.637181
  type: 'test'
  ...
# Subtest: cotas são por estação — régua da DCRS não herda a cota do Gasômetro
ok 10 - cotas são por estação — régua da DCRS não herda a cota do Gasômetro
  ---
  duration_ms: 2.315585
  type: '

...[saída cortada]...

ifica mesmo sem cota da régua
  ---
  duration_ms: 8.751949
  type: 'test'
  ...
# [collect] INMET avisos indisponível: fetch inesperado no teste: https://apiprevmet3.inmet.gov.br/avisos/ativos
# [collect] INMET avisos indisponível: fetch inesperado no teste: https://apiprevmet3.inmet.gov.br/avisos/ativos
# Subtest: inscrição morta (410) é apagada em vez de tentar para sempre
ok 91 - inscrição morta (410) é apagada em vez de tentar para sempre
  ---
  duration_ms: 11.740383
  type: 'test'
  ...
# Subtest: /health não vaza endpoint nem chaves das inscrições
ok 92 - /health não vaza endpoint nem chaves das inscrições
  ---
  duration_ms: 3.969904
  type: 'test'
  ...
# [collect] INMET avisos indisponível: fetch inesperado no teste: https://apiprevmet3.inmet.gov.br/avisos/ativos
# [collect] INMET avisos indisponível: fetch inesperado no teste: https://apiprevmet3.inmet.gov.br/avisos/ativos
# Subtest: quem acompanha a bacia recebe o alerta de outra estação dela
ok 93 - quem acompanha a bacia recebe o alerta de outra estação dela
  ---
  duration_ms: 10.915703
  type: 'test'
  ...
1..93
# tests 93
# suites 0
# pass 93
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 697.690026

```

### ✅ OK
- Comando: `node /tmp/check_html_inline_scripts.js /home/eduardodlima/projetos/guaiba-monitor`
- Exit code: `0`
- Tempo: `0.08s`

```text
/home/eduardodlima/projetos/guaiba-monitor/index.html script #1 OK
```


## Propostas gerais de melhoria

1. Separar código fonte em estrutura clara (`src/`, `public/`, testes).

## Próximo passo sugerido

Priorizar pequenas melhorias incrementais com teste antes/depois, porque o estado atual validou sem falhas nos checks executados.
