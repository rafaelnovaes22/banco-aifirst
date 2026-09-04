# Banco AI First

Sandbox operacional de conta PJ com cockpit, agentes, BaaS portável e aprovação humana.

## Comandos

```powershell
npm run verify      # gate único: formato + lint + tipos + testes + build + evals
npm test            # vitest run, sem credenciais, stub determinístico
npm run typecheck   # tsc --noEmit
npm run build       # tsc -p tsconfig.build.json
npm run demo        # roteiro de 10 min com dados fictícios, sem parceiro real
npm run lint        # eslint da API (painel tem o próprio)
npm run format:check # prettier check, sem escrever
```

Setup inicial: `bin/setup.ps1` no Windows, `bin/setup.sh` no Unix. Idempotente, pode rodar 2 vezes.

## Regras

- Monte dependências só em `src/app-context.ts`. Rotas recebem tudo injetado, sem estado global.
- Valide borda com Zod (`safeParse`). Nada de `any`, `strict: true`.
- Funções de 4 a 20 linhas, arquivos até 500 (alvo 200 a 300). Comentário `PORQUÊ` explica decisão, nunca o óbvio.
- Dinheiro só move em `pix-out-executor.ts` via `BaasProvider`. LLM nunca executa, só sugere rascunho.
- Logs com `app.log.info({campo}, 'msg')`. Proibido `console.log` fora de `src/demo/`.
- Produção exige `DATABASE_URL` e `SESSION_SECRET`; sem eles o processo falha fechado.
- Segredo de webhook vem de env (`BAAS_WEBHOOK_SECRET`). Seed só com `SEED_DEMO=true`.
- Diagnostique antes de alterar. Não refatore lógica de negócio em tarefa de infra.
