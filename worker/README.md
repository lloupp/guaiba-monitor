# Worker do Guaiba Monitor

O que a página estática não faz: **avisar com o telefone bloqueado**.

O Worker coleta a telemetria a cada 10 minutos, compara com a coleta anterior e
manda Web Push para quem acompanha a estação afetada. Também serve os JSONs
coletados, o que dispensa o commit a cada meia hora no repositório.

## O que ele expõe

| Rota | Para quê |
|---|---|
| `POST /subscribe` | guarda a inscrição de push (endpoint + chaves + estação) |
| `POST /unsubscribe` | apaga a inscrição na hora |
| `GET /data/realtime.json` | leituras das 130 estações |
| `GET /data/stations.json` | catálogo (nome, bacia, coordenadas) |
| `GET /data/history.json` | histórico de 72 h das estações acompanhadas |
| `GET /health` | última coleta, nº de estações e de inscrições |

## Deploy

```bash
cd worker

# 1. par de chaves VAPID (uma vez; guarde as duas)
npx web-push generate-vapid-keys

# 2. namespace do KV → copie o id para o wrangler.toml
npx wrangler kv namespace create GUAIBA_KV

# 3. a chave pública é pública mesmo: vai no wrangler.toml [vars]
#    e em data/push-config.json do site

# 4. a privada é secret — nunca no repositório
npx wrangler secret put VAPID_PRIVATE_KEY

# 5. publicar
npx wrangler deploy

# 6. conferir
curl https://guaiba-monitor.<sua-conta>.workers.dev/health
```

Depois do deploy, aponte o site para o Worker em `data/push-config.json`:

```json
{
  "subscribeUrl": "https://guaiba-monitor.<sua-conta>.workers.dev/subscribe",
  "unsubscribeUrl": "https://guaiba-monitor.<sua-conta>.workers.dev/unsubscribe",
  "vapidPublicKey": "<chave pública VAPID>"
}
```

Sem esse arquivo o app simplesmente não oferece push — nada quebra.

## Consumo no plano gratuito

Cada execução do cron faz ~4 escritas no KV (realtime, stations, history,
snapshot). Com `*/10`, são ~576 escritas/dia, dentro do limite de 1.000/dia.
**Aumentar a frequência do cron estoura esse limite** — se precisar de mais,
migre os dados para R2 ou reduza o que vai para o histórico.

## Privacidade

Guarda-se o endpoint de push, as chaves da própria inscrição e a estação
escolhida. Sem nome, telefone ou coordenada: quando a pessoa usa "estação mais
próxima", o cálculo acontece no aparelho e só o código da estação é enviado.
Toda inscrição expira em 180 dias, e `/unsubscribe` apaga imediatamente.

## Regras de disparo

Estão em `js/events.js`, com testes em `test/events.test.js`:

1. dado simulado nunca vira notificação;
2. leitura com mais de 1 hora não dispara nada;
3. cota de uma régua não classifica outra;
4. alerta da Defesa Civil sozinho não vira emergência (a severidade dele é
   heurística de título);
5. cooldown por gravidade impede repetir a mesma escalada.
