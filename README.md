# 🌊 Guaiba Monitor — Nível do Rio e Desastres Naturais

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?logo=githubpages)](https://lloupp.github.io/guaiba-monitor/)

Monitor web do nível do rio **Guaíba** e riscos de desastres naturais em **Porto Alegre e região metropolitana** (Porto Alegre, Canoas, Guaíba e região). Alertas de enchente, ciclone bomba, vendaval, granizo e deslizamento.

## Recursos

- 📏 **Nível do Guaíba** — leitura atual em metros + cota de referência
- 📈 **Gráfico de histórico** — curva do nível ao longo do tempo (Canvas) com linha de transbordo
- 🚨 **Alertas ativos** — INMET e Defesa Civil RS com severidade colorida (amarelo/laranja/vermelho)
- 🗺️ **Riscos por região** — Porto Alegre, Canoas, Guaíba e região
- 🌪️ **Tipos de risco** — enchente, ciclone bomba, vendaval, granizo, deslizamento, alagamento
- 📋 **Checklist de preparação** — kit emergência, rotas de fuga
- 💾 **Offline** — histórico salvo no navegador (localStorage)
- 📱 **Responsivo** — celular, tablet e desktop

## Fontes de dados

- **IPH-UFRGS / CPRM-SACE** — nível do Guaíba
- **INMET** — alertas meteorológicos
- **Defesa Civil RS** — avisos oficiais
- **MetSul** — meteorologia regional

> ⚠️ A Fase 1 valida os endpoints reais. Até lá, dados podem usar fallback de exemplo (sempre marcados como simulação).

## Tech Stack

- HTML5 + CSS3 + JavaScript vanilla
- Canvas API para gráficos
- fetch para APIs públicas
- localStorage (prefixo `gm_`)

## Como usar

Abra `index.html` no navegador. Pronto.

## Deploy (GitHub Pages)

O site está publicado no GitHub Pages:

🔗 **https://lloupp.github.io/guaiba-monitor/**

### Como foi configurado

- **Habilitado via GitHub API** (`POST /repos/{owner}/{repo}/pages`) com `build_type: "legacy"`, fonte: branch `master`, caminho `/ (root)`. Cada push em `master` atualiza o site automaticamente.
- **`.nojekyll`** na raiz impede o processamento Jekyll, garantindo que todos os arquivos estáticos (HTML/CSS/JS/ESM) sejam servidos corretamente.
- Para reconfigurar via CLI:
  ```bash
  gh api -X POST repos/lloupp/guaiba-monitor/pages \
    -f source='{"branch":"master","path":"/"}'
  ```

### Desenvolvimento local

Como é um site estático puro (sem build step), basta abrir `index.html` no navegador. Para testar localmente:
```bash
npx serve .   # ou python3 -m http.server 8080
```

### Qualidade / testes

Testes das funções puras (node:test, sem dependências de browser) e lint:
```bash
npm install     # instala eslint (dev)
npm test        # roda os testes em test/
npm run lint    # eslint em js/
```

## Licença

MIT
