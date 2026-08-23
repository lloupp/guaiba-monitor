import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, raiz), 'utf8');

/** Módulos alcançáveis a partir de js/app.js, seguindo os imports. */
function modulosDoApp() {
  const vistos = new Set();
  const visita = (arquivo) => {
    if (vistos.has(arquivo)) return;
    vistos.add(arquivo);
    let conteudo;
    try { conteudo = ler(`js/${arquivo}`); } catch { return; }
    for (const m of conteudo.matchAll(/from '\.\/([\w-]+\.js)'/g)) visita(m[1]);
  };
  visita('app.js');
  return [...vistos];
}

test('todo módulo que o app importa está no pré-cache do Service Worker', () => {
  // Sem isto, o app abre offline e quebra com "failed to fetch dynamically
  // imported module" — falha que só aparece justamente quando falta rede.
  const sw = ler('sw.js');
  const faltando = modulosDoApp().filter((m) => !sw.includes(`'./js/${m}'`));
  assert.deepEqual(faltando, [], `módulos fora do pré-cache: ${faltando.join(', ')}`);
});

test('o carimbo de versão cobre todos os módulos do shell', () => {
  // Um módulo fora do hash significa que mudá-lo não gera versão nova, e quem
  // já instalou continua com o código antigo.
  const stamp = ler('scripts/stamp-sw.js');
  const faltando = modulosDoApp().filter((m) => !stamp.includes(`'js/${m}'`));
  assert.deepEqual(faltando, [], `módulos fora do carimbo: ${faltando.join(', ')}`);
});

test('módulos de servidor não entram no shell do navegador', () => {
  // events.js e sources.js rodam no Worker/coletor. No pré-cache, seriam peso
  // baixado à toa por quem está com rede ruim.
  const sw = ler('sw.js');
  for (const servidor of ['events.js', 'sources.js']) {
    assert.ok(!sw.includes(`'./js/${servidor}'`), `${servidor} não deve estar no pré-cache`);
  }
});

test('nenhum recurso externo bloqueia o primeiro carregamento', () => {
  const html = ler('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  // preconnect é permitido (só abre a conexão); css/js externo, não.
  const externosBloqueantes = [...head.matchAll(/<(?:script|link)[^>]*(?:src|href)="(https?:\/\/[^"]+)"[^>]*>/g)]
    .filter((m) => !/rel="preconnect"/.test(m[0]))
    .map((m) => m[1]);
  assert.deepEqual(externosBloqueantes, [], 'o Leaflet e afins devem ser carregados sob demanda');
});

test('todo arquivo js/ tem sintaxe válida e não sobrou import morto', () => {
  const arquivos = readdirSync(new URL('js/', raiz)).filter((f) => f.endsWith('.js'));
  for (const arquivo of arquivos) {
    const conteudo = ler(`js/${arquivo}`);
    for (const m of conteudo.matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      assert.ok(
        arquivos.includes(m[1]),
        `${arquivo} importa ${m[1]}, que não existe`
      );
    }
  }
});
