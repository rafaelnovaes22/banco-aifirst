# Fluxo OS, Banco AI First

Sandbox operacional de um banco empresarial orientado por agentes. O cockpit aceita comandos em linguagem natural, prepara ações financeiras, exige decisão humana, persiste o estado e produz auditoria verificável.

## O que funciona

- Sessão anônima isolada por organização, com cookie `HttpOnly`, `SameSite=Strict` e CSRF rotativo.
- Caixa, projeções, cobranças, favorecidos sandbox e fila de aprovações persistidos no PostgreSQL.
- Pix exclusivamente demonstrativo, sem chave livre e sem movimentação de dinheiro real.
- Idempotência persistente, concorrência otimista e transações com bloqueio por organização.
- Auditoria append-only com hash SHA-256 encadeado e exportação CSV.
- Guardrails determinísticos contra prompt injection e gate mínimo de 95% nos evals.

## Rodar

Requer Node.js 22 e PostgreSQL.

```powershell
$env:DATABASE_URL="postgresql://usuario:senha@localhost:5432/banco_aifirst"
$env:APP_ORIGIN="http://localhost:8080"
npm ci
npm run build
npm start
```

Acesse `http://localhost:8080`. O schema é criado de forma idempotente no início do processo.

## Verificar

```powershell
npm run verify
docker build -t banco-aifirst .
```

O gate único valida formato, lint, tipos, testes, build, smoke, segurança, ataques de prompt injection e cenários golden.

`npm run test:postgres:local` acrescenta testes reais de persistência, concorrência e integridade em PostgreSQL 16 descartável. Consulte [arquitetura e limites](docs/ARCHITECTURE.md) e [liberação](docs/RELEASE.md).

## Arquitetura

- `src/runtime/`: aplicação segura, política de comandos, sessões e persistência.
- `src/runtime/postgres-repository.ts`: pool único, queries parametrizadas e transações PostgreSQL.
- `src/web/cockpit.ts`: integração do cockpit com a API same-origin.
- `src/domain/`: núcleo financeiro e adaptadores portáveis cobertos por regressão.
- `evals/`: cenários de intenção, ação, qualidade e segurança.
- `governance/`: mapa de dados, riscos e controles de IA.

O adaptador Asaas é testado contra o contrato oficial, mas fica desligado no runtime público. O serviço publicado opera somente como sandbox.

## Limite legal

Este projeto não é uma instituição financeira. Não abre contas, não recebe depósitos e não movimenta dinheiro. Os valores e favorecidos são fictícios.

Produção: https://banco-aifirst-production.up.railway.app
