# Liberação do sandbox

## Produção atual

`https://rafaelnovaes22.github.io/banco-aifirst/`, via `.github/workflows/pages.yml`.

- Artefato: `dist/pages` gerado por `npm run build:pages`.
- Sessão em `localStorage` deste dispositivo, sem conta e sem rede.
- Maker-checker por papéis: o agente cria com `actorId`, só o papel humano
  (`approverId`) aprova. Alçada de R$ 5.000 no Pix.
- O runtime Node com PostgreSQL continua no repo (Dockerfile, `npm start`)
  para operação própria futura, mas não atende mais a produção pública.

Não apontar Fluxo Conta Panel para esta demo: os contratos públicos são diferentes (`/api/v1` versus `/api`).

## Gates reproduzíveis

Dentro do ai-jail, com Node 22:

```sh
npm ci
npm run verify
npm run build:pages
npm run test:sites
```

`npm run test:postgres:local` segue válido para o runtime Node com PostgreSQL 16
descartável em loopback. Não usa `DATABASE_URL` de produção.

## Verificação após publicar

Abrir a URL do Pages, criar sessão, consultar cockpit, preparar Pix fictício
com valor explícito, revisar favorecido, aprovar uma vez e verificar
saldo/auditoria. Recarregar e verificar persistência local. Abrir outro
navegador privado e verificar isolamento. Exportar o CSV e conferir a cadeia.
Testar comando de injeção e conferir o bloqueio com auditoria.

Registrar deployment ID do Pages, commit e SHA publicado. Não interpretar os
testes locais como deploy executado.
