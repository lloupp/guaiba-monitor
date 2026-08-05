// api.js — Coleta de dados (IPH/CPRM/INMET/Defesa Civil)
//
// Fase 1 — Endpoints validados e documentados
// Ver docs/fase1-fontes-e-endpoints.md para detalhes completos.
//
// Endpoints confirmados:
//   ✓ INMET  /avisos/ativos        — JSON, CORS aberto, sem auth
//   ✓ INMET  /previsao/{geocode}   — JSON, CORS aberto, sem auth (ex: 4314902=POA)
//   ✓ CPRM   /sace/                — HTML (visualização), SEM API JSON
//   ✓ DCRS   /avisos-e-alertas     — HTML (scraping recomendado via proxy)
//
// Endpoints NÃO funcionais:
//   ✗ IPH-UFRGS /telemetria/       — 404 (página removida)
//   ✗ CPRM      guaiba_sace_popup  — 404
//
// IMPORTANTE: Nível do Guaíba não tem endpoint JSON público sem CORS/token.
// Solução para MVP: dados de exemplo marcados como "simulação/offline".

// === Configuração ===
const ENDPOINTS = {
  inmetAlertas: 'https://apiprevmet3.inmet.gov.br/avisos/ativos',
  inmetPrevisao: (geocode) => `https://apiprevmet3.inmet.gov.br/previsao/${geocode}`,
  cprmSace: 'https://www.cprm.gov.br/sace/',
  dcrsAvisos: 'https://www.defesacivil.rs.gov.br/avisos-e-boletins',
  dcrsAlertas: 'https://www.defesacivil.rs.gov.br/avisos-e-alertas',
};

// Geocodes IBGE
const GEOCODES = {
  portoAlegre: '4314902',
  canoas: '4304606',
  guaiba: '4304308',
};

// Estados monitorados (para filtrar alertas INMET)
const ESTADOS_MONITORADOS = ['Rio Grande do Sul'];

// Será implementado na Fase 3 — exports
export { ENDPOINTS, GEOCODES, ESTADOS_MONITORADOS };
export default ENDPOINTS;
