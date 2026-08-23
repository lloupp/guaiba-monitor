// stamp-sw.js — Carimba o sw.js com a versão do shell.
//
// Por que existe: o Service Worker cacheia o app shell de forma ATÔMICA por
// versão (cache-first dentro da versão). Isso evita o pior modo de falha de um
// PWA em ES modules — app.js novo carregando utils.js velho, que quebra o app
// inteiro com "does not provide an export named ...".
//
// A troca de versão é o que publica o código novo. Esquecer de trocá-la
// prenderia todo mundo na versão antiga, então a versão é DERIVADA do conteúdo:
// hash dos arquivos do shell. Rode antes de publicar (ou no CI):
//
//   node scripts/stamp-sw.js        # grava a versão
//   node scripts/stamp-sw.js --check # falha se estiver desatualizada (CI)

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const SW_FILE = new URL('sw.js', ROOT);

// Arquivos que compõem o shell — mudou qualquer um, a versão muda.
const SHELL_FILES = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/utils.js',
  'js/config.js',
  'js/levels.js',
  'js/risks.js',
  'js/alerts.js',
  'js/elnino.js',
  'js/push.js',
  'js/leaflet-loader.js',
  'js/my-level.js',
  'js/shelters.js',
  'manifest.json',
];

/**
 * Hash curto do conteúdo do shell.
 * Inclui o próprio sw.js (sem a linha da versão, que seria recursiva): mudar
 * só a estratégia de cache também precisa gerar versão nova, senão o Service
 * Worker antigo continua no ar.
 * @returns {Promise<string>}
 */
export async function shellHash() {
  const hash = createHash('sha1');
  for (const file of SHELL_FILES) {
    hash.update(file);
    hash.update(await readFile(new URL(file, ROOT)));
  }
  const sw = await readFile(SW_FILE, 'utf8');
  hash.update(sw.replace(/const APP_VERSION = '[^']*'/, ''));
  return hash.digest('hex').slice(0, 10);
}

/** Versão gravada hoje no sw.js. @returns {Promise<string|null>} */
export async function currentVersion() {
  const sw = await readFile(SW_FILE, 'utf8');
  const m = /const APP_VERSION = '([^']+)'/.exec(sw);
  return m ? m[1] : null;
}

async function main() {
  const check = process.argv.includes('--check');
  const hash = await shellHash();
  const version = `v${hash}`;
  const atual = await currentVersion();

  if (atual === version) {
    console.log(`sw.js já está em ${version}`);
    return;
  }

  if (check) {
    console.error(
      `sw.js está em ${atual}, mas o shell mudou (esperado ${version}).\n` +
      'Rode "npm run stamp-sw" e comite o sw.js — sem isso, quem já instalou o app não recebe esta versão.'
    );
    process.exit(1);
  }

  const sw = await readFile(SW_FILE, 'utf8');
  await writeFile(SW_FILE, sw.replace(/const APP_VERSION = '[^']*'/, `const APP_VERSION = '${version}'`));
  console.log(`sw.js: ${atual} → ${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[stamp-sw]', err.message);
    process.exit(1);
  });
}
