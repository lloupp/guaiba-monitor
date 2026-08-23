import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDcrsRss,
  extractRegions,
  municipiosFromStations,
  selectTrackedStations,
  buildStationCatalog,
} from '../js/sources.js';

test('parseDcrsRss extrai títulos e dados dos itens', () => {
  const xml = `
<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Defesa Civil</title>
  <item>
    <title>Defesa Civil alerta: condição de ALERTA para Instabilidades atuam na região de Porto Alegre, com tempestade</title>
    <description><![CDATA[Risco de vento forte e granizo. Válido até 6h.]]></description>
    <link>http://defesacivil.rs.gov.br/alerta-poa</link>
    <pubDate>Fri, 07 Aug 2026 01:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Defesa Civil alerta SEVERO/CELL BROADCAST para Instabilidades na região de Canoas</title>
    <description><![CDATA[Chuva intensa.]]></description>
    <link>http://defesacivil.rs.gov.br/severo-canoas</link>
    <pubDate>Fri, 07 Aug 2026 02:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Defesa Civil alerta: condição de ATENÇÃO para rajadas de vento na região Sul</title>
    <description><![CDATA[Risco baixo.]]></description>
  </item>
</channel></rss>
`;
  const alerts = parseDcrsRss(xml);
  assert.equal(alerts.length, 3);

  // severidade baseada na CONDITION, não no texto padrão
  assert.equal(alerts[0].severity, 'perigo'); // ALERTA
  assert.equal(alerts[1].severity, 'emergencia'); // SEVERO/CELL BROADCAST
  assert.equal(alerts[2].severity, 'atencao'); // ATENÇÃO

  // link decodificado (sem CDATA)
  assert.equal(alerts[1].link, 'http://defesacivil.rs.gov.br/severo-canoas');
  assert.ok(!/CDATA/.test(alerts[0].link));

  // regions preenchidas
  assert.ok(Array.isArray(alerts[0].regions) && alerts[0].regions.length > 0);

  // mensagem decodificada
  assert.match(alerts[0].message, /Risco de vento forte/);
});

test('parseDcrsRss retorna [] para xml sem itens', () => {
  assert.deepEqual(parseDcrsRss('<rss></rss>'), []);
  assert.deepEqual(parseDcrsRss(''), []);
  assert.deepEqual(parseDcrsRss(null), []);
});

test('extractRegions casa municípios reais e ignora o nome do estado', () => {
  const municipios = ['Quaraí', 'Santa Maria', 'Rio Grande', 'Porto Alegre'];
  assert.deepEqual(
    extractRegions('Defesa Civil alerta: ELEVAÇÃO do rio Quaraí. Risco de inundação em Quaraí.', municipios),
    ['Quaraí']
  );
  // "Rio Grande do Sul" não pode virar o município "Rio Grande"
  assert.deepEqual(
    extractRegions('PROGNÓSTICO METEOROLÓGICO PARA O RIO GRANDE DO SUL', municipios),
    ['Rio Grande do Sul']
  );
  // acento e caixa não importam
  assert.deepEqual(extractRegions('chuva forte em PORTO ALEGRE', municipios), ['Porto Alegre']);
  // fronteira de palavra: não casa dentro de outra palavra
  assert.deepEqual(extractRegions('nada aqui', municipios), ['Rio Grande do Sul']);
});

test('municipiosFromStations extrai municípios dos nomes das estações', () => {
  const municipios = municipiosFromStations([
    { stationName: 'Santo Antônio das Missões/São Borja' },
    { stationName: 'Barra do Ribeiro - Lago Guaíba' },
    { stationName: 'Arroio do Meio/Lajeado (H)' },
  ]);
  assert.ok(municipios.includes('São Borja'));
  assert.ok(municipios.includes('Barra do Ribeiro'));
  assert.ok(municipios.includes('Lajeado'));
  assert.ok(!municipios.some((m) => m.includes('(H)')));
});

test('selectTrackedStations acompanha o Guaíba e quem estiver em alarme', () => {
  const tracked = selectTrackedStations([
    { stationCode: 'DCRS-00054', basin: 'RS - Lago Guaíba', alarmStatus: 0 },
    { stationCode: 'DCRS-00900', basin: 'RS - Rio Ibicuí', alarmStatus: 0 },
    { stationCode: 'DCRS-00901', basin: 'RS - Rio Ibicuí', alarmStatus: 2 },
  ]);
  const codes = tracked.map((t) => t.stationCode);
  assert.ok(codes.includes('DCRS-00054'), 'estação do Guaíba entra sempre');
  assert.ok(codes.includes('DCRS-00901'), 'estação em alarme entra');
  assert.ok(!codes.includes('DCRS-00900'), 'estação sem alarme e fora do Guaíba fica de fora');
});

test('buildStationCatalog guarda o que não muda a cada coleta', () => {
  const cat = buildStationCatalog([
    { stationCode: 'B', stationName: 'Bagé', basin: 'x', latitude: -31, longitude: -54, altitude: 200, levelMeters: 2 },
    { stationCode: 'A', stationName: 'Alegrete', basin: 'y', latitude: -29, longitude: -55, altitude: 100, levelMeters: 3 },
  ]);
  assert.deepEqual(cat.map((c) => c.code), ['A', 'B'], 'ordenado por código');
  assert.equal(cat[0].levelMeters, undefined, 'leitura não entra no catálogo');
});
