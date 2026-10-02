import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryBankRepository } from "../src/runtime/memory-repository.js";
import { buildBankServer } from "../src/runtime/server.js";

const origin = "https://bank.example.test";
let app: FastifyInstance;

beforeEach(async () => {
  const repository = new MemoryBankRepository();
  await repository.initialize();
  app = await buildBankServer(repository, {
    appOrigin: origin,
    cookieName: "__Host-fluxo_session",
    secureCookie: true,
    logger: false,
  });
});

afterEach(async () => {
  await app.close();
});

async function startSession(): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({ method: "POST", url: "/api/v1/session" });
  const rawSetCookie = response.headers["set-cookie"];
  const setCookie = Array.isArray(rawSetCookie)
    ? rawSetCookie[0]
    : rawSetCookie;
  const cookie = setCookie?.split(";")[0];
  expect(response.statusCode).toBe(200);
  expect(cookie).toBeTruthy();
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  return { cookie: cookie ?? "", csrf: response.json().csrfToken as string };
}

describe("API persistente do Banco AI First", () => {
  it("recusa abrir ou renovar sessão a partir de outra origem", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/session",
      headers: { origin: "https://untrusted.example" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("aceita abertura de sessão por clientes que marcam POST vazio como form", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/session",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().csrfToken).toBeTruthy();
  });

  it("não expõe cockpit sem sessão", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cockpit",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SESSION_REQUIRED");
  });

  it("cria sessão isolada e entrega o cockpit", async () => {
    const session = await startSession();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cockpit",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().company.name).toBe("Novaes Comércio Ltda.");
    expect(response.json().recipients).toHaveLength(2);
  });

  it("não compartilha estado entre duas sessões", async () => {
    const first = await startSession();
    const second = await startSession();
    await app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: actionHeaders(first, "isolation-command-0001"),
      payload: { text: "Faça um Pix de R$ 100 para o fornecedor" },
    });
    const firstView = await app.inject({
      method: "GET",
      url: "/api/v1/cockpit",
      headers: { cookie: first.cookie },
    });
    const secondView = await app.inject({
      method: "GET",
      url: "/api/v1/cockpit",
      headers: { cookie: second.cookie },
    });

    expect(firstView.json().approvals).toHaveLength(2);
    expect(secondView.json().approvals).toHaveLength(1);
    expect(firstView.json().company.sessionLabel).not.toBe(
      secondView.json().company.sessionLabel,
    );
  });

  it("exige origem, CSRF e idempotência nas mutações", async () => {
    const session = await startSession();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrf,
        "idempotency-key": "command-0001",
      },
      payload: { text: "Faça um Pix de R$ 100" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ORIGIN_REJECTED");
  });

  it("prepara e aprova uma operação somente dentro do sandbox", async () => {
    const session = await startSession();
    const command = await app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: actionHeaders(session, "command-0002"),
      payload: { text: "Faça um Pix de R$ 100 para o fornecedor" },
    });
    const approval = command.json().approval;
    const decision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/decisions`,
      headers: actionHeaders(session, "decision-0002"),
      payload: { decision: "APPROVE", expectedVersion: approval.version },
    });
    const cockpit = await app.inject({
      method: "GET",
      url: "/api/v1/cockpit",
      headers: { cookie: session.cookie },
    });

    expect(command.statusCode).toBe(200);
    expect(decision.statusCode).toBe(200);
    expect(decision.json().movement.status).toBe("SANDBOX_CONFIRMED");
    expect(cockpit.json().money.balanceInCents).toBe(28_724_000);
  });

  it("exporta uma cadeia de auditoria verificada", async () => {
    const session = await startSession();
    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit",
      headers: { cookie: session.cookie },
    });
    const csv = await app.inject({
      method: "GET",
      url: "/api/v1/audit/export",
      headers: { cookie: session.cookie },
    });

    expect(audit.json().integrity).toBe("VERIFIED");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("SANDBOX_CRIADO");
  });

  it("reflete a indisponibilidade do banco de dados no health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "reachable" });
  });

  it("calcula o piloto shadow autenticado", async () => {
    const session = await startSession();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/b2b-shadow",
      headers: actionHeaders(session, "shadow-0001"),
      payload: {
        csv: [
          "id;data;descricao;valor;direcao",
          "m1;2026-09-01;TED cliente Alfa;1.500,00;IN",
          "m2;2026-09-02;Pix cliente Beta;200,00;IN",
          "m3;2026-09-03;Tarifa manutencao;10,00;OUT",
          "m4;2026-09-04;TED fornecedor Gama;800,00;OUT",
        ].join("\n"),
        comprovantes: [
          { amountInCents: 150000, occurredOn: "2026-09-01" },
          { amountInCents: 20000, occurredOn: "2026-09-02" },
        ],
      },
    });
    const relatorio = response.json();

    expect(response.statusCode).toBe(200);
    expect(relatorio.totalExtrato).toBe(4);
    expect(relatorio.unicas).toBe(2);
    expect(relatorio.taxaAutoBaixa).toBe(0.5);
    expect(relatorio.economiaMensalEmCentavos).toBeGreaterThan(0);
    expect(relatorio.linhasDre.length).toBeGreaterThan(0);
    expect(relatorio.textoResumoDre).toContain("R$");
  });

  it("não calcula shadow sem sessão", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/b2b-shadow",
      payload: { csv: "id;data;descricao;valor" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SESSION_REQUIRED");
  });

  it("rejeita extrato fora do contrato", async () => {
    const session = await startSession();
    const vazio = await app.inject({
      method: "POST",
      url: "/api/v1/b2b-shadow",
      headers: actionHeaders(session, "shadow-0002"),
      payload: {},
    });
    const semMovimento = await app.inject({
      method: "POST",
      url: "/api/v1/b2b-shadow",
      headers: actionHeaders(session, "shadow-0003"),
      payload: { csv: "nada aqui" },
    });

    expect(vazio.statusCode).toBe(400);
    expect(vazio.json().error.code).toBe("INVALID_BODY");
    expect(semMovimento.statusCode).toBe(422);
    expect(semMovimento.json().error.code).toBe("INVALID_EXTRATO");
  });
});

function actionHeaders(
  session: { cookie: string; csrf: string },
  idempotencyKey: string,
) {
  return {
    cookie: session.cookie,
    origin,
    "x-csrf-token": session.csrf,
    "idempotency-key": idempotencyKey,
  };
}
