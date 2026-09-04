# Banco AI First: arquitetura verificável

Revisão: 2026-09-04. Escopo: sandbox empresarial, sem dinheiro real.

## Jornada e componentes

O navegador abre `app.html` em `/`, cria uma sessão opaca e consulta `/api/v1/cockpit`. O mesmo serviço Fastify entrega HTML, assets e API. O classificador determinístico reconhece comandos em português brasileiro, prepara aprovações e registra decisões humanas. Não há chamada de LLM no runtime público.

`BankApplication` usa `PostgresBankRepository`; os adaptadores antigos em `src/domain` não estão conectados ao entrypoint de produção. O Fluxo Conta API e Panel são outro produto de demonstração, com implantação e armazenamento independentes. Compartilham origem de código, não contas, sessões ou saldos. Nenhuma integração entre os três serviços está concluída.

## Dados e garantias testadas

- `organizations`: estado JSONB isolado por UUID de organização, versão e timestamps.
- `sessions`: hashes SHA-256 do token e CSRF, referência da organização e expiração de oito horas. O segredo bruto fica somente no cookie HttpOnly ou na memória do navegador.
- `audit_records`: sequência por organização, hash encadeado e gatilhos contra UPDATE, DELETE e TRUNCATE.
- Cada mutação bloqueia a linha da organização com `FOR UPDATE`; estado e auditoria são gravados na mesma transação. As últimas 256 respostas de mutação por organização sustentam a idempotência. Não é deduplicação ilimitada.

Testes com PostgreSQL 16 real provaram inicializações concorrentes, sessão reencontrada por outra instância, hashes em disco, expiração, isolamento, conflito de duas aprovações, débito único, rollback e proteção dos registros de auditoria. Testes unitários não são tratados como comprovação de BaaS real.

## Cloud e capacidade

Container Node 22, usuário `node`, Fastify em `PORT` (padrão 8080), PostgreSQL por `DATABASE_URL`. `APP_ORIGIN` deve ser a origem HTTPS pública exata. `/health` consulta o banco e responde indisponibilidade quando a conexão falha. O processo fecha o pool no desligamento.

O pool limita dez conexões por réplica, espera de conexão de cinco segundos e consultas de dez segundos. Um advisory lock serializa a inicialização do schema. Começar com uma réplica; múltiplas réplicas exigem dimensionamento do PostgreSQL e limitador distribuído, pois o rate limit atual vive na memória de cada processo. O runtime confia apenas no primeiro salto do proxy.

Não foram medidos throughput, carga sustentada, RTO ou RPO. Sessões anônimas podem criar organizações continuamente. Antes de ampliar tráfego é necessário definir quotas duráveis, retenção e limpeza de dados de demonstração. Não executar limpeza da auditoria pelo usuário da aplicação.

## Credenciais e recuperação

`DATABASE_URL` é segredo do serviço Railway. `APP_ORIGIN`, `NODE_ENV` e `PORT` não são segredos. Não configurar chaves Asaas, Telegram, WhatsApp ou LLM neste runtime. Backups devem pertencer ao PostgreSQL; um volume na aplicação não substitui backup do banco.

Os triggers bloqueiam mutações acidentais, mas um administrador PostgreSQL pode desativá-los. Hash encadeado não substitui armazenamento externo imutável nem controle de acesso administrativo. Separar papel de migração do papel de execução é requisito antes de dados regulados. O runtime atual inicializa schema com a própria conexão.

O operador deve ativar backup do serviço PostgreSQL, registrar frequência/retenção e ensaiar restauração em ambiente isolado. Nenhum teste desta entrega prova que um backup cloud está ativo. PostgreSQL PITR requer base backup e arquivo contínuo de WAL; não está implementado pelo código da aplicação.

## Limites funcionais

Pix, tributos, reserva, risco e projeções são cenários fictícios. O parser aceita valores monetários brasileiros explícitos; valores inválidos não viram transferências padrão. Favorecidos são fixos e mostrados para revisão. Aprovar bloqueio de risco não debita o saldo. O classificador não pesquisa a internet, não determina conformidade regulatória e não suporta todas as línguas ou culturas. Não há onboarding bancário, depósito, crédito, KYC real ou licença financeira.

## Fontes oficiais consultadas

- [node-postgres: transações no mesmo client](https://node-postgres.com/features/transactions).
- [PostgreSQL 16: bloqueios de linha e advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html).
- [PostgreSQL 16: backup e recuperação](https://www.postgresql.org/docs/16/backup.html).
- [Railway: backups de volumes](https://docs.railway.com/volumes/backups).
- [Fastify: trustProxy e limites do servidor](https://fastify.dev/docs/latest/Reference/Server/).
- [MDN: atributos de cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
