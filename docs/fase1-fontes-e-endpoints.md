# Fase 1 — Pesquisa de Fontes e Validação de Endpoints

> Data: 2026-08-05  
> Testado via curl no Termux (Android).

## Resumo

| Fonte | Endpoint | Status | Auth | Observações |
|-------|----------|--------|------|-------------|
| INMET — Alertas ativos | `https://apiprevmet3.inmet.gov.br/avisos/ativos` | ✅ HTTP 200 | Nenhuma | JSON completo com todos os alertas do Brasil. **Funciona perfeitamente sem CORS server-side** — o navegador pode buscar direto (CORS aberto). |
| INMET — Previsão por município | `https://apiprevmet3.inmet.gov.br/previsao/{geocode_IBGE}` | ✅ HTTP 200 | Nenhuma | ex: `4314902` = Porto Alegre. Retorna previsão para hoje + 4 dias (manhã/tarde/noite) com temp_max, temp_min, resumo, ícone, vento, umidade, nascer/pôr do sol. |
| INMET — Previsão por estado | `https://apiprevmet3.inmet.gov.br/previsao/{UF}` | ✅ (a testar) | Nenhuma | Retorna previsão para todas as cidades do estado. |
| CPRM SACE — Página HTML | `https://www.cprm.gov.br/sace/` | ✅ HTTP 200 | Nenhuma | HTML. Monitora bacia do Guaíba (`bguaiba`). Tem sub-páginas: `index_bacias_monitoradas.php`, `index_manchas_inundacao.php`, etc. **Não expõe JSON** — apenas visualização. |
| CPRM SACE — Mapeamento | `https://www.cprm.gov.br/sace/index_bacias_monitoradas.php` | ✅ HTTP 200 | Nenhuma | Lista bacias monitoradas, inclui "Bacia do Rio Guaíba" com links: SACE Monitoramento, Características, Mapeamento de Risco, Municípios, Boletins. |
| CPRM SACE — Mapa estações | `https://www.cprm.gov.br/sace/sace_nivel/estacoes_mapa.php?bacia=brasil` | ✅ HTTP 200 | Nenhuma | HTML com mapa Leaflet + estações. **Não há endpoint JSON documentado** para obter nível das réguas via API client-side. |
| CPRM SACE — Popup Guaíba | `guaiba_sace_popup.php` | ❌ HTTP 404 | — | O popup específico redireciona para um servidor antigo (sgb.gov.br) que retorna 404. **Sem via API programável neste momento.** |
| Defesa Civil RS — Página inicial | `https://www.defesacivil.rs.gov.br/` | ✅ HTTP 200 (após redirect 303→200) | Nenhuma | HTML. Mostra alertas ativos em vigor. |
| Defesa Civil RS — Avisos e Boletins | `https://www.defesacivil.rs.gov.br/avisos-e-boletins` | ✅ HTTP 200 | Nenhuma | HTML com links para PDFs de avisos meteorológicos e hidrometeorológicos. Permite scraping. |
| Defesa Civil RS — Avisos e Alertas | `https://www.defesacivil.rs.gov.br/avisos-e-alertas` | ✅ HTTP 200 | Nenhuma | HTML com lista de alertas ativos. Permite scraping. |
| IPH-UFRGS — Telemetria | `https://www.ufrgs.br/iph/telemetria/` | ❌ HTTP 404 | — | Página não encontrada. IPH não possui mais telemetria online pública em /telemetria/. |
| IPH-UFRGS — Home | `https://www.ufrgs.br/iph/` | ✅ HTTP 200 | Nenhuma | Página institucional, sem dados de nível online. |
| Porto Alegre — Cais Mauá | `https://www.portoalegre.rs.gov.br/caismaua` | ❌ HTTP 404 | — | URL antiga não existe. |
| Porto Alegre — SMA | `https://www.portoalegre.rs.gov.br/sma/nivel-rios` | ✅ HTTP 200 | Nenhuma | HTML. Não testado a fundo — pode ter scraping dos níveis. |
| SNIRH HidroWeb | `https://www.snirh.gov.br/hidroweb/` | ✅ HTTP 200 | Nenhuma | SPA (Angular). API REST existemas requer autenticação para dados detalhados. |

## Estratégia de coleta (decisões arquiteturais)

### 1. Nível do Guaíba — SEM ENDPOINT PÚBLICO DIRETO
- Nenhuma fonte fornece nível do Guaíba via JSON client-side sem CORS issues ou autenticação.
- **CPRM SACE** tem os dados, mas apenas via visualização HTML/Leaflet — não há API JSON pública documentada.
- **Solução**: 
  - Para MVP: usar dados de exemplo (sample) **marcados como "simulação/offline"**.
  - Para uso real: documentar que nível deve ser inserido manualmente ou via proxy server.
  - Manter arquitetura flexível em `api.js` para que, quando um endpoint JSON/CORS for documentado, basta plugar.

### 2. INMET Alertas — FUNCIONA, usar direto no fetch
- `https://apiprevmet3.inmet.gov.br/avisos/ativos` — CORS **aberto**, JSON limpo, sem auth.
- **Estrutura**: objeto com chave `"hoje"` (array). Cada alerta tem:
  - `id`, `severidade` ("Perigo Potencial", etc.), `aviso_cor` (hex), `descricao` ("Vendaval", "Chuva", etc.)
  - `estados` (string separado por vírgula — filtrar clientes-side por "Rio Grande do Sul")
  - `riscos` (array de strings), `instrucoes` (array de strings)
  - `inicio` e `fim` (texto), `municipios` (codigos IBGE), `geocodes`
- **Endpoint de previsão** também funciona: `/previsao/{geocode_IBGE}`

### 3. Defesa Civil RS — SCRAPING HTML (último recurso)
- Não há JSON/API — as páginas `/avisos-e-alertas` e `/avisos-e-boletins` são HTML.
- **CORS**: Ainda **não confirmado** se permite fetch direto do navegador (testar com modo `cors`). Provável **não** — pode ser necessário um proxy serverless ou marcar como "fallback".
- Solução MVP: parse HTML no `api.js` (com DOMParser) **via proxy** (ex: `api.allorigins.win`) e fallback para dados de exemplo.

### 4. Cotas de transbordo oficiais — NÃO CONFIRMADAS pivô-to-ok
- As cotas atuais no `ref-levels.json` (1,5/2,0/2,5/3,0 m) são **valores aproximados históricos**.
- **CPRM/Defesa Civil RS** não expõe a cota oficial numérica atual via API JSON.
- **Ação**: manter os valores aproximados em `ref-levels.json` com nota clara. Atualizar se um dia um endpoint for documentado.

## Detalhes técnicos

### INMET `/avisos/ativos` — Schema (resumo)
```json
{
  "hoje": [
    {
      "id": 55247,
      "severidade": "Perigo Potencial",
      "aviso_cor": "#FFFE00",
      "descricao": "Vendaval",
      "inicio": "2026-08-07 00:00",
      "fim": "2026-08-08 23:59",
      "estados": "Paraná, Santa Catarina, Rio Grande do Sul, São Paulo, ...",
      "riscos": ["Vento variando entre 40 km/h e 60 km/h. Baixo risco de queda de galhos de árvores."],
      "instrucoes": ["Em caso de rajadas de vento: (não se abrigue debaixo de árvores, ...) "],
      "municipios": "Abadia de Goiás - GO (5200050), ...",
      "geocodes": "4100103, 4200051, ...",
      "microrregioes": "...",
      "mesorregioes": "...",
      "regioes": "Sul, Sudeste, Centro-Oeste"
    }
  ],
  "encerrados": []
}
```

### INMET `/previsao/{geocode}` — Schema (resumo)
```json
{
  "4314902": {
    "05/08/2026": {
      "manha": {
        "uf": "RS",
        "entidade": "Porto Alegre",
        "resumo": "Muitas nuvens com nevoeiro",
        "temp_max": 22,
        "temp_min": 18,
        "dir_vento": "NE-E",
        "int_vento": "Fracos",
        "icone": "data:image/png;base64,...",
        "dia_semana": "Quarta-feira",
        "umidade_max": 95,
        "umidade_min": 50,
        "fonte": "prevmet"
      },
      "tarde": {...},
      "noite": {...}
    }
  }
}
```

### Testes executados
```
$ curl -s -m 15 -H "User-Agent: Mozilla/5.0" "https://apiprevmet3.inmet.gov.br/avisos/ativos"
→ HTTP 200, JSON com 1 alerta ativo (Vendaval, severidade "Perigo Potencial", UF lista inclui RS)

$ curl -s -m 15 -H "User-Agent: Mozilla/5.0" "https://apiprevmet3.inmet.gov.br/previsao/4314902"
→ HTTP 200, JSON com previsão para POA (manhã/tarde/noite, temp 18-22°C)

$ curl -sL -m 15 -H "User-Agent: Mozilla/5.0" "https://www.cprm.gov.br/sace/"
→ HTTP 200, HTML com "Bacia do Rio Guaíba" listada

$ curl -sL -m 15 -H "User-Agent: Mozilla/5.0" "https://www.defesacivil.rs.gov.br/avisos-e-boletins"
→ HTTP 200, HTML com links para PDFs de avisos

$ curl -sL -m 15 -H "User-Agent: Mozilla/5.0" "https://www.ufrgs.br/iph/telemetria/"
→ HTTP 404 (Página não encontrada)
```

## Salvamento para uso das próximas fases
- Campos-chave do schema Level: `levelMeters`, `trend`, `recordedAt`, `source`
- Alertas INMET mapeiam: `severidade` → `alertCode`, `descricao` → título, `riscos`[].`instrucoes` → message
- Para filtrar alertas RS, comparar `estados` (string) contém "Rio Grande do Sul"
