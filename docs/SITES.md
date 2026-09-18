# Banco AI First no Sites

MVP do Fluxo OS empacotado para ChatGPT Sites: Worker com os mesmos HTML, cockpit e
contratos `/api/v1` do Railway, persistência em D1 isolada por sessão.

## Escopo

Sandbox demonstrativo. Sem dinheiro real, sem instituição financeira, sem KYC real,
sem certificação. Limites: 300 sessões, 15 novas por hora, 180 chamadas por minuto
por sessão, 1.000 eventos de auditoria e 750 KB de estado por sessão.

Diferença contra o Railway: no Sites vale alçada de R$ 5.000 e aprovador diferente
do criador na decisão de Pix. Acima da alçada ou com o mesmo ator, a decisão volta
403 `POLICY_BLOCKED` com o motivo, e a auditoria registra o bloqueio.

## Comandos

```powershell
npm run build:sites   # bundle do worker em dist/sites
npm run dev:sites      # Miniflare local na porta 8003 com D1 próprio
npm run test:sites     # tipos mais 9 testes, inclui paridade nos golden do Railway
```

Verificação local completa: subir `dev:sites` e rodar o roteiro E2E (saúde, sessão,
cockpit, comando, Pix, maker-checker, aprovação, débito único, replay 409, injeção,
auditoria verificada, exportação CSV, governança, isolamento e origem).

## Publicação

1. Criar o projeto Sites e anotar o `project_id` em `.openai/hosting.json`.
2. Commit em branch própria e push do mesmo commit ao repositório do Sites.
3. `npm run build:sites`, conferir o SHA com `git rev-parse --verify HEAD`.
4. Salvar a versão com esse SHA, acompanhar o status até concluir.
5. Verificar no domínio final: raiz, `/health`, demo, comando, aprovação e auditoria.
6. Nunca persistir credencial de publicação. URL reservada não prova disponibilidade.
