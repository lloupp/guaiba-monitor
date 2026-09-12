# Sincronizar guaiba-monitor com o remoto

## Contexto

- Ramal atual: `feat/fase0-dados-honestos` (5 commits locais não no remoto)
- `master` local está **378 commits atrás** de `origin/master`
- `origin/master` é `https://github.com/lloupp/guaiba-monitor.git`
- Tentativa anterior de merge gerou conflitos em `package.json`, `sw.js`, e arquivos de dados
- O ramal feature removeu o diretório `worker/` que existe no remoto

## Riscos

- Conflitos de merge em arquivos de dados JSON (`data/history.json`, `data/realtime.json`, `data/elnino.json`) — são gerados automaticamente e podem sobrescrever dados locais
- O `worker/` local pode ser deletado ao mergear com origin/master
- 378 commits é uma quantidade grande; pode haver conflitos complexos em CI/CD

## Passos

- [x] 1. Atualizar `master` local para espelhar `origin/master` → verifica: `git rev-list --count master..origin/master` = 0
   ✅ Feito: `git reset --hard origin/master`, HEAD em caf62f7
- [ ] 2. Reunir `feat/fase0-dados-honestos` sobre o `master` atualizado → verifica: `git merge-base --is-ancestor master feat/fase0-dados-honestos`
- [ ] 3. Resolver conflitos de merge do ramal feature → verifica: `git diff --name-only --diff-filter=U` retorna vazio
- [ ] 4. Verificar status final do repositório → verifica: `git status --short --branch` limpo, sem conflitos
- [ ] 5. Verificar se feat branch está sincronizada com remoto → verifica: `git rev-list --count HEAD..origin/feat/fase0-dados-honestos` = 0 (ou informar se existe)
