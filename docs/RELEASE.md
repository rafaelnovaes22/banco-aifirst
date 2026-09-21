# Liberação do sandbox

## Configuração

Serviço existente: `https://banco-aifirst-production.up.railway.app`.

- `APP_ORIGIN=https://banco-aifirst-production.up.railway.app`
- `DATABASE_URL`: referência privada ao PostgreSQL escolhido pelo operador, sem copiar o valor para arquivos.
- `PORT=8080`, `NODE_ENV=production`.
- Dockerfile da raiz, healthcheck `/health`, uma réplica inicial.

Não apontar Fluxo Conta Panel para esta API: os contratos públicos são diferentes (`/api/v1` versus `/api`).

## Gates reproduzíveis

Dentro do ai-jail, com Node 22:

```sh
npm ci
npm run verify
npm run test:postgres:local
```

O último comando inicia um PostgreSQL 16 descartável em loopback, porta 55439, e encerra a instância no final. `PG_BIN` e `PG_TEST_PORT` permitem ajustar caminhos locais. Não usa `DATABASE_URL` de produção. Alternativa CI: fornecer `BANK_TEST_DATABASE_URL` de um banco de teste cujo nome termine em `_test` e executar `npm run test:postgres`.

## Verificação após publicar

Abrir `/`, criar sessão, consultar cockpit, preparar Pix fictício com valor explícito, revisar favorecido, aprovar uma vez e verificar saldo/auditoria. Reabrir com o mesmo cookie e verificar persistência. Abrir outro navegador privado e verificar isolamento. Testar `/health`; a indisponibilidade do PostgreSQL deve impedir o início de operação financeira simulada.

O deploy e o backup cloud são coordenados separadamente da alteração de código. Registrar deployment ID, commit, serviço PostgreSQL e evidência de restauração. Não interpretar os testes locais como deploy executado.
