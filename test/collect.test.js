import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDcrsRss } from '../scripts/collect.js';

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
