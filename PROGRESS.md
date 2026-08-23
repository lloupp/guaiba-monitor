# Guaiba Monitor — estado do projeto

## Onde está

O app é um PWA estático (GitHub Pages, ES modules, sem build) que mostra o
nível dos rios do RS a partir da telemetria da Defesa Civil, com avisos por Web
Push quando a estação acompanhada escala de faixa ou entra em alarme oficial.

**Três regras valem mais que qualquer funcionalidade** (todas com teste):

1. o app nunca exibe leitura inventada — sem dado, ele diz que não tem e explica;
2. cota de uma régua não classifica outra — cada estação tem zero próprio;
3. o app não inventa destino de fuga, abrigo ou rota.

## Fases

### Fase 0 — Parar de mostrar dado falso ✅ (2026-08-21)
- `sampleLevels`/`sampleAlerts` fora de produção → `test/fixtures/`
- estado vazio honesto, com o motivo (sem conexão / coleta sem nível / erro)
- rotas de fuga inventadas removidas → telefones oficiais + plano escrito pela pessoa
- cotas por estação (`data/ref-levels.json`); classificação: cota da régua →
  alarme oficial da Defesa Civil → "sem referência"
- `isFresh` passa a bloquear alerta, não a esconder leitura

### Fase 1 — Todo o RS ✅ (2026-08-21)
- 130 estações (eram 2), com alarme de inundação, chuva 24h/72h e deslizamento
- `data/stations.json` (catálogo) + `realtime.json` enxuto (141 KB → 43 KB)
- bacia inferida por proximidade onde a API não informa (40 → 12 sem bacia)
- histórico por estação (72 h)
- estação mais próxima por geolocalização (cálculo no aparelho)
- alertas localizados por município real e filtrados por região

### Fase 2 — Avisos com o app fechado ✅ (2026-08-22)
- Cloudflare Worker (`worker/`): `/subscribe`, `/unsubscribe`, `/data/:file`,
  `/health` e cron de 10 min
- Web Push (RFC 8291/8292) só com Web Crypto — o `web-push` do Node não roda em
  Workers; validado decifrando o resultado com biblioteca independente
- regras de disparo em `js/events.js`, todas testadas
- **Falta**: publicar o Worker e preencher `data/push-config.json`

### Fase 3 — Feito para o celular ✅ (2026-08-22)
- Lighthouse mobile: performance 99, acessibilidade 100, boas práticas 100, SEO 100
- INMET saiu do navegador (760 KB por abertura) para o coletor
- Leaflet sob demanda; gráfico com toque, pinça e teclado
- modo emergência (offline, alto contraste); "quanto falta até a minha casa";
  compartilhar por Web Share; atalhos no manifest

### Fase 5 — Não regredir ✅ (2026-08-23)
- `.github/workflows/ci.yml`: lint, testes, carimbo do SW e JSONs válidos
- `.github/workflows/monitor-fontes.yml`: verifica as fontes todo dia e abre
  issue quando alguma cai (`npm run check-sources`)

### Fase 4 — Abrigos e rotas ⏸ bloqueada na origem
Não há fonte aberta viva: `api.sos-rs.com` (plataforma de 2024) está fora do ar
e o portal de dados abertos de Porto Alegre não tem dataset de abrigo nem de
defesa civil. A fase começa por **conseguir a fonte**, não por programar —
inventar abrigo repetiria o erro das rotas de fuga removidas na Fase 0.
Ver a seção "Abrigos" no README para o estado da busca.

## Como verificar

```bash
npm test              # testes + carimbo do Service Worker
npm run lint
npm run check-sources # as fontes externas ainda respondem?
npm run collect       # coleta real, grava em data/
npm run stamp-sw      # antes de publicar, sempre
```
