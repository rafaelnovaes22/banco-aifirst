# Fluxo OS, Banco AI First

MVP demonstrativo de um banco empresarial operado por agentes. A experiência mostra comando em linguagem natural, orquestração, fila de aprovação humana, auditoria exportável e controles de governança.

## Escopo

Este projeto não é uma instituição financeira. Não abre contas, não recebe depósitos e não movimenta dinheiro. Todos os dados são simulados e permanecem no navegador.

## Rodar

```powershell
python -m http.server 8000
```

Acesse `http://localhost:8000` e abra a demonstração.

## Verificar

```powershell
node evals/smoke.mjs
node tests/bank-core.test.mjs
node scripts/guardrails-check.mjs
node scripts/iso-static-check.ts
docker build -t banco-aifirst .
```

## Arquitetura

- `index.html`: tese e proposta para parceiros.
- `app.html`: cockpit interativo.
- `scripts/bank-core.js`: classificação determinística e políticas HITL.
- `scripts/bank-demo.js`: estado da simulação e trilha de auditoria.
- `evals/golden.json`: 20 cenários de intenção, ação e aprovação.
- `governance/`: mapa de dados e registro de riscos.
- `nginx.conf`: headers de segurança e endpoint `/health`.

O gate atual exige pelo menos 95% de acerto. A suíte cobre consultas, simulações, execuções sensíveis e 38 ataques de prompt injection em português e inglês.

Produção: https://banco-aifirst-production.up.railway.app
