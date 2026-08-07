# 🌊 Guaiba Monitor — Nível do Rio e Desastres Naturais

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?logo=githubpages)](https://lloupp.github.io/guaiba-monitor/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Monitor web do nível do rio **Guaíba** e riscos de desastres naturais em **Porto Alegre e região metropolitana** (Porto Alegre, Canoas, Guaíba e região). Alertas de enchente, ciclone bomba, vendaval, granizo e deslizamento.

## Recursos

- 📏 **Nível do Guaíba** — leitura atual em metros + cota de referência
- 📈 **Gráfico de histórico** — curva do nível ao longo do tempo (Canvas) com linha de transbordo e referência de maio/2024 (5.30 m)
- 🚨 **Alertas ativos** — INMET com severidade colorida (amarelo/laranja/vermelho)
- 🗺️ **Riscos por região** — Porto Alegre, Canoas, Guaíba e região
- 🌪️ **Tipos de risco** — enchente, ciclone bomba, vendaval, granizo, deslizamento, alagamento, ressaca
- 📋 **Checklist de preparação** — kit emergência (8 itens) + rotas de fuga (3 itens)
- 💾 **Offline** — histórico salvo no navegador (localStorage com prefixo `gm_`)
- 📱 **Responsivo** — celular, tablet e desktop
- 🔔 **PWA instalável** — adiciona à tela inicial, funciona offline após primeiro carregamento

## Fontes de dados — status real (validado 2026-08-06)

| Dado | Fonte | Status | Observação |
|---|---|---|---|
| **Nível do Guaíba** | [Defesa Civil RS](https://redehidrometeorologica.defesacivil.rs.gov.br/graphql) (GraphQL) | ✅ **Ao vivo** | Estação DCRS-00054 (Barra do Ribeiro - Lago Guaíba). Dados via `tags_data` query, sem auth. Coletado pelo GitHub Actions a cada 30min. |
| **Alertas meteorológicos** | [INMET](https://apiprevmet3.inmet.gov.br/avisos/ativos) | ✅ **Ao vivo** | JSON, sem auth, CORS aberto. Filtrado para RS. |
| **Previsão do tempo POA** | [INMET](https://apiprevmet3.inmet.gov.br/previsao/4314902) | ✅ **Ao vivo** | 5 dias, dado por geocode IBGE |
| **Alertas DCRS** | [Defesa Civil RS](https://www.defesacivil.rs.gov.br/rss) (RSS) | ✅ **Ao vivo** | RSS parseado no GitHub Actions, gravado em data/realtime.json |
| **El Niño/La Niña** | [NOAA CPC](https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for) | ✅ **Ao vivo** | Anomalias de SST semanais, coletado pelo GitHub Actions |
| Côta de transbordo | Defesa Civil RS (histórico) | 📏 Aproximada | 1.5 / 2.0 / 2.5 / 3.0 m — valores de referência históricos; CPRM/DCRS não publicam cota numérica oficial via API. |

### Fontes descartadas (testadas, não funcionais)

- ❌ **IPH-UFRGS telemetria** (`ufrgs.br/iph/telemetria/`) — 404 desde ago/2025 (página removida)
- ❌ **CPRM SACE antigo** (`cprm.gov.br/sace/`) — 301 → sgb.gov.br; sem estação do Guaíba em POA
- ❌ **Defesa Civil RS** (`defesacivil.rs.gov.br`) — só HTML, sem JSON; scraping via proxy é frágil
- ❌ **ANA HIDROWEB** (`snirh.gov.br/hidroweb/api/`) — REST retorna 404; SPA sem API pública
- ❌ **ANA telemetria** (`telemetriaservicos.ana.gov.br`) — DNS não resolve
- ❌ **CEMADEN API** — endpoints públicos não documentados/404
- ❌ **Google Public Alerts** — serviço descontinuado

> As fontes inválidas foram removidas do `api.js` em 2026-08-06. O app **não inventa dados** — quando uma fonte falha, mostra "simulação/offline" e usa fallback marcado como tal.

## Tech Stack

- HTML5 + CSS3 + JavaScript vanilla (ES modules, sem frameworks, sem build)
- Canvas API para gráficos (nível + performance)
- fetch para APIs públicas
- localStorage (prefixo `gm_`)
- PWA: Web App Manifest + Service Worker (offline-first para assets)
- SEO: Open Graph + JSON-LD `WebApplication`

## Como usar

Abra `https://lloupp.github.io/guaiba-monitor/` no navegador, pronto. Para instalar como app no Android: menu → "Adicionar à tela inicial".

### Desenvolvimento local

Como é um site estático puro (sem build step), basta abrir `index.html` no navegador. Para testar localmente:
```bash
npx serve .   # ou python3 -m http.server 8080
```

### Testes

```bash
# Valida sintaxe de todos os JS
for f in js/*.js; do node --check "$f" && echo "✅ $f OK" || echo "❌ $f ERROR"; done

# Valida JSON
python3 -c "import json; json.load(open('data/ref-levels.json'))"

# Testes lógicos (estrutura de alertas, matriz de risco)
bash tests/run.sh
```

Ver `tests/` para os testes automatizados de lógica (alerts.js, risks.js).

## Deploy (GitHub Pages)

🔗 **https://lloupp.github.io/guaiba-monitor/**

- **Modo**: legacy (deploy do branch `master` direto, sem GitHub Actions)
- Cada push em `master` atualiza o site automaticamente (~2 min)
- **`.nojekyll`** na raiz impede processamento Jekyll (necessário para ESM/static)

```bash
gh api -X POST repos/lloupp/guaiba-monitor/pages \
  -f source='{"branch":"master","path":"/"}'
```

## Licença

MIT
