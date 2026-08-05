# 🌊 Guaiba Monitor — Nível do Rio e Desastres Naturais

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

## Licença

MIT
