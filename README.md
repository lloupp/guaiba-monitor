# 🌊 Guaiba Monitor — Nível do Rio e Desastres Naturais

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?logo=githubpages)](https://lloupp.github.io/guaiba-monitor/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Monitor web do nível dos rios e riscos de desastre no **Rio Grande do Sul** — as **130 estações** da Rede Hidrometeorológica da Defesa Civil RS, de Porto Alegre ao Vale do Taquari. Alertas de enchente, ciclone bomba, vendaval, granizo e deslizamento.

## Recursos

- 📏 **Nível do rio** — leitura atual em metros, com a hora da medição e a base da classificação (cota oficial da régua ou alarme da Defesa Civil)
- 📈 **Gráfico de histórico** — curva do nível ao longo do tempo (Canvas). Linha de transbordo e referência de maio/2024 só aparecem na régua a que pertencem
- 🚨 **Alertas ativos** — INMET com severidade colorida (amarelo/laranja/vermelho)
- 🗺️ **Riscos por região** — a estação escolhida e as vizinhas da mesma bacia (rio acima e rio abaixo)
- 📍 **Estação mais próxima** — com permissão de localização; a coordenada não sai do aparelho
- 🌪️ **Tipos de risco** — enchente, ciclone bomba, vendaval, granizo, deslizamento, alagamento, ressaca
- 📋 **Checklist de preparação** — kit de emergência (8 itens) + plano de saída escrito pela própria pessoa (3 itens)
- ☎️ **Telefones oficiais** — Defesa Civil 199, Bombeiros 193, SAMU 192, Brigada 190 (funcionam sem internet)
- 💾 **Offline** — histórico salvo no navegador (localStorage com prefixo `gm_`)
- 📱 **Feito para o celular** — gráfico com toque e pinça, alvos grandes, sem rolagem horizontal
- 🆘 **Modo emergência** — nível, o que fazer, telefones e seu plano de saída numa tela só, funcionando sem internet
- 📏 **"Quanto falta até a minha casa"** — você marca a sua referência na régua e o app diz quantos centímetros faltam e, se estiver subindo, o tempo estimado
- 📤 **Compartilhar** — manda a situação para vizinhos sem o app (Web Share)
- 🔄 **Atualização avisada** — quando sai versão nova, o app avisa em vez de ficar preso na antiga
- 🔔 **Aviso com o app fechado** — Web Push pelo Cloudflare Worker quando a sua estação escala de faixa ou entra em alarme oficial
- 🔔 **PWA instalável** — adiciona à tela inicial, funciona offline após primeiro carregamento

## Fontes de dados — status real (validado 2026-08-06)

| Dado | Fonte | Status | Observação |
|---|---|---|---|
| **Nível do Guaíba** | [Defesa Civil RS](https://redehidrometeorologica.defesacivil.rs.gov.br/graphql) (GraphQL) | ✅ **Ao vivo** | Estação DCRS-00054 (Barra do Ribeiro - Lago Guaíba). Dados via `tags_data` query, sem auth. Coletado pelo GitHub Actions a cada 30min. |
| **Alertas meteorológicos** | [INMET](https://apiprevmet3.inmet.gov.br/avisos/ativos) | ✅ **Ao vivo** | JSON, sem auth, CORS aberto. Filtrado para RS. |
| **Previsão do tempo POA** | [INMET](https://apiprevmet3.inmet.gov.br/previsao/4314902) | ✅ **Ao vivo** | 5 dias, dado por geocode IBGE |
| **Alertas DCRS** | [Defesa Civil RS](https://www.defesacivil.rs.gov.br/rss) (RSS) | ✅ **Ao vivo** | RSS parseado no GitHub Actions, gravado em data/realtime.json |
| **El Niño/La Niña** | [NOAA CPC](https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for) | ✅ **Ao vivo** | Anomalias de SST semanais, coletado pelo GitHub Actions |
| **Alarme de inundação** | [Defesa Civil RS](https://redehidrometeorologica.defesacivil.rs.gov.br/graphql) (GraphQL) | ✅ **Ao vivo** | `rio_alarmes.inundacao.status` por estação — classifica as réguas que não têm cota numérica publicada. |
| **Chuva acumulada** | [Defesa Civil RS](https://redehidrometeorologica.defesacivil.rs.gov.br/graphql) (GraphQL) | ✅ **Ao vivo** | Acumulados de 24h e 72h por estação. |
| Cotas de inundação | ANA/SGB (Gasômetro 2.60 m, Cais Mauá 3.00 m) | 📏 Por estação | Cotas **não são intercambiáveis**: cada régua tem zero próprio. As estações da DCRS não têm cota publicada e por isso usam o alarme oficial. Ver `data/ref-levels.json`. |

### Fontes descartadas (testadas, não funcionais)

- ❌ **IPH-UFRGS telemetria** (`ufrgs.br/iph/telemetria/`) — 404 desde ago/2025 (página removida)
- ❌ **CPRM SACE antigo** (`cprm.gov.br/sace/`) — 301 → sgb.gov.br; sem estação do Guaíba em POA
- ❌ **Defesa Civil RS** (`defesacivil.rs.gov.br`) — só HTML, sem JSON; scraping via proxy é frágil
- ❌ **ANA HIDROWEB** (`snirh.gov.br/hidroweb/api/`) — REST retorna 404; SPA sem API pública
- ❌ **ANA telemetria** (`telemetriaservicos.ana.gov.br`) — DNS não resolve
- ❌ **CEMADEN API** — endpoints públicos não documentados/404
- ❌ **Google Public Alerts** — serviço descontinuado

> ❌ **SGB/SACE** (`sace.sgb.gov.br/api/dados/guaiba_72_cota.csv`) — CSV fora do ar (404 em 21/08/2026); a página da estação do Gasômetro responde "Dados insuficientes".
> ❌ **api.sos-rs.com** (abrigos de 2024) — fora do ar.
> ❌ **GraphQL `historic`** da DCRS — existe, mas exige autenticação ("Forbidden resource"). O histórico é acumulado pelo próprio coletor.

> **O app não inventa dados.** Desde a Fase 0 não existe mais leitura de exemplo em produção: sem dado real, a tela diz que não há leitura e explica o motivo. Os dados de exemplo vivem em `test/fixtures/` e só alimentam testes.

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
npm test    # 39 testes (node:test) — alertas, riscos, classificação, coletor
npm run lint
```

Os testes cobrem, entre outros, a regra central do projeto: **cota de uma régua nunca classifica outra**, e `api.js` não pode voltar a exportar dados de exemplo (`test/classification.test.js`).

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


## Regras do projeto

Três decisões que valem mais que qualquer funcionalidade:

1. **Nunca exibir dado inventado.** Sem leitura real, a tela diz que não há leitura e explica o motivo. Os dados de exemplo ficam em `test/fixtures/` e só alimentam testes.
2. **Cota de uma régua nunca classifica outra.** Cada estação tem zero próprio: a cota de 2,60 m do Gasômetro não diz nada sobre a régua de Barra do Ribeiro. Sem cota publicada, a classificação vem do alarme oficial da Defesa Civil (`rio_alarmes.inundacao.status`).
3. **O app não inventa destino de fuga.** Ele mostra os telefones oficiais e guarda o plano que a própria pessoa escreveu.

## Abrigos

O app **não inventa abrigo**. Cada ponto exibido carrega de onde veio e quando
foi verificado; item sem essas duas informações é descartado na carga
(`js/shelters.js`, testado em `test/shelters.test.js`). Enquanto
`data/shelters.json` estiver vazio, a seção não aparece e o app mostra a
orientação que funciona sempre: **ligue 199 e pergunte**.

### Estado da busca por fonte (23/08/2026)

| Fonte | Situação |
|---|---|
| **SOS RS / Sedes** — plataforma oficial de monitoramento de abrigos | 🕐 **existe, mas indisponível**: `sosenchentes.rs.gov.br/abrigos` redireciona para o aviso de período eleitoral. Os portais do governo do RS estão com conteúdo restrito desde **4/7/2026**, até o resultado das eleições (1º turno em 4/10/2026). É a fonte a plugar quando voltar. |
| `api.sos-rs.com` (plataforma de 2024) | ❌ fora do ar |
| `sos-rs.magnobiet.com` | ⚠️ espelho histórico: os dados param em maio de 2024 |
| **`sos-rs.com`** | 🚨 **não use e não linke**: o domínio foi perdido e hoje hospeda um site de apostas |
| `dadosabertos.poa.br` | ❌ sem dataset de abrigo ou de defesa civil (busca retorna zero) |
| Defesa Civil RS — páginas de abrigos/dados abertos | ❌ 404 |

Quando a plataforma voltar: confirmar o endpoint, escrever o coletor em
`js/sources.js` e preencher `data/shelters.json` no formato documentado dentro
do próprio arquivo. A interface já está pronta e testada — inclusive a marcação
de "verificado há N dias" para informação que envelheceu.

**Rotas de fuga continuam fora do escopo.** Rota calculada por conta própria em
cidade alagada manda gente para dentro d'água; só entra camada oficial de vias
bloqueadas, se houver.

## Desempenho e acessibilidade

Medido com Lighthouse em perfil **mobile com 4G lento**, servindo com gzip
(como o GitHub Pages entrega):

| | |
|---|---|
| Performance | **99** |
| Acessibilidade | **100** |
| Boas práticas | **100** |
| SEO | **100** |

O que mais pesava era invisível: o app buscava os avisos do INMET direto do
navegador — **760 KB sem compressão**, com os avisos do Brasil inteiro, para
mostrar alguns do RS. Isso saiu para o coletor: hoje o celular recebe só os
avisos já filtrados, dentro do `realtime.json`. O tempo até a página ficar
utilizável caiu de 6,7 s para 2,0 s.

O Leaflet (~150 KB) também saiu do caminho crítico: carrega quando o mapa do
El Niño se aproxima da tela, e nunca se a pessoa não rolar até lá.

A primeira visita baixa cerca de **68 KB de código** (gzip) e **11 KB de dados**.

## Avisos com o app fechado (Web Push)

Um site aberto avisa quem está olhando. O que salva alguém de madrugada é a
notificação que chega com o telefone bloqueado — e isso exige um servidor.

O `worker/` é um Cloudflare Worker que, a cada 10 minutos, coleta a telemetria,
compara com a coleta anterior e notifica **só quem acompanha a estação afetada**.
Roda no plano gratuito. Passo a passo em [`worker/README.md`](worker/README.md).

Enquanto `data/push-config.json` estiver vazio, o app funciona normalmente e
avisa apenas com ele aberto — o push é um extra, não um requisito.

**As regras de disparo** (em `js/events.js`, com testes em `test/events.test.js`):

| Regra | Por quê |
|---|---|
| Dado simulado nunca notifica | um alerta falso destrói a confiança de quem depende do app |
| Leitura com mais de 1 h não dispara | se a coleta travou, o silêncio é honesto |
| Cota de uma régua não classifica outra | mesma regra do app |
| Alerta da Defesa Civil sozinho não vira emergência | a severidade dele vem de heurística de título |
| Cooldown por gravidade | a mesma escalada não notifica duas vezes |
| Primeira rodada não notifica | senão quem instala recebe todos os alertas ativos de uma vez |

A criptografia do push (RFC 8291) é implementada só com Web Crypto em
`worker/src/webpush.js` — o `web-push` do Node não roda em Workers. O teste
`test/webpush.test.js` confere o resultado decifrando-o com uma biblioteca
independente e validando a assinatura VAPID.

## Publicação

O Service Worker cacheia o app shell de forma atômica por versão, e a versão é o hash do conteúdo:

```bash
npm run stamp-sw   # carimba sw.js com o hash do shell — rode antes de publicar
```

`npm test` falha se o `sw.js` estiver desatualizado, e o workflow de coleta também confere. Sem esse carimbo, quem já instalou o app continuaria na versão antiga.
