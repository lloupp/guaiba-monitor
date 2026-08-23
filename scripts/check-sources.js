// check-sources.js — Verifica se as fontes externas ainda respondem.
//
// O projeto depende de serviços públicos que mudam de endereço, saem do ar ou
// param de publicar sem aviso — já aconteceu com o CSV do SGB/SACE, com a API
// de abrigos de 2024 e com a telemetria do IPH. Sem esta checagem, a queda só
// apareceria quando alguém precisasse de um alerta que não veio.
//
// Uso:
//   node scripts/check-sources.js      # relatório em markdown no stdout
//   sai com código 1 se alguma fonte essencial falhou (o CI abre uma issue)

import { collectLevel, collectElNino, collectDcrsAlerts, collectInmetAlerts } from '../js/sources.js';

/** @typedef {{nome: string, essencial: boolean, verificar: () => Promise<string>}} Fonte */

/** @type {Fonte[]} */
const FONTES = [
  {
    nome: 'Defesa Civil RS — telemetria (GraphQL)',
    essencial: true, // sem ela o app não tem nível: é a fonte principal
    async verificar() {
      const r = await collectLevel();
      if (!r || r.stations.length === 0) throw new Error('nenhuma estação retornou nível');
      const comAlarme = r.stations.filter((s) => s.alarmStatus != null).length;
      return `${r.stations.length} estações, ${comAlarme} com alarme publicado`;
    },
  },
  {
    nome: 'Defesa Civil RS — avisos (RSS)',
    essencial: true,
    async verificar() {
      const alertas = await collectDcrsAlerts([]);
      // Zero alertas é um estado válido (dia calmo); o parse é o que importa.
      return `${alertas.length} aviso(s)`;
    },
  },
  {
    nome: 'INMET — avisos meteorológicos',
    essencial: false, // enriquece, mas o app funciona sem
    async verificar() {
      const alertas = await collectInmetAlerts([]);
      return `${alertas.length} aviso(s) para o RS`;
    },
  },
  {
    nome: 'NOAA CPC — El Niño/La Niña',
    essencial: false,
    async verificar() {
      const e = await collectElNino();
      if (!e) throw new Error('sem leitura');
      return `${e.state} (Niño 3.4 ${e.regions.nino34.ssta.toFixed(2)} °C, semana ${e.week})`;
    },
  },
];

async function main() {
  const linhas = ['## Verificação das fontes', '', '| Fonte | Estado | Detalhe |', '|---|---|---|'];
  let essencialFora = false;

  for (const fonte of FONTES) {
    try {
      const detalhe = await fonte.verificar();
      linhas.push(`| ${fonte.nome} | ✅ no ar | ${detalhe} |`);
    } catch (err) {
      const marca = fonte.essencial ? '❌ **fora**' : '⚠️ fora';
      linhas.push(`| ${fonte.nome} | ${marca} | ${err.message} |`);
      if (fonte.essencial) essencialFora = true;
      else console.error(`[check] ${fonte.nome}: ${err.message}`);
    }
  }

  linhas.push('', `_Verificado em ${new Date().toISOString()}._`);
  console.log(linhas.join('\n'));

  if (essencialFora) process.exit(1);
}

main().catch((err) => {
  console.error('[check-sources] falhou:', err.message);
  process.exit(1);
});
