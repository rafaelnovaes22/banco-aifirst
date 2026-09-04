import { describe, expect, it, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SupportTicketQueue } from "../src/domain/support-ticket-queue.js";
import type { TransactionMirror } from "../src/domain/receipt-matcher.js";
import {
  registerReceiptsApi,
  type ReceiptsApiDeps,
} from "../src/http/api-receipts.js";

function buildApp(): { app: FastifyInstance; tickets: SupportTicketQueue } {
  const app = Fastify({ logger: false });
  const tickets = new SupportTicketQueue();
  const deps: ReceiptsApiDeps = {
    statementsByOrg: new Map<string, TransactionMirror[]>(),
    tickets,
    auditSink: () => undefined,
  };
  void registerReceiptsApi(app, deps);
  return { app, tickets };
}

const statement = {
  orgId: "org-1",
  transactionId: "tx-1",
  amountInCents: 15_000,
  direction: "IN",
  occurredOn: "2026-09-02",
} as const;

describe("receipts API", () => {
  let app: FastifyInstance;
  let tickets: SupportTicketQueue;

  beforeEach(() => {
    ({ app, tickets } = buildApp());
  });

  it("sincroniza extrato e casa comprovante único", async () => {
    await app.inject({
      method: "POST",
      url: "/api/receipts/statements",
      payload: statement,
    });
    const match = await app.inject({
      method: "POST",
      url: "/api/receipts/match",
      payload: {
        orgId: "org-1",
        amountInCents: 15_000,
        occurredOn: "2026-09-02",
      },
    });
    expect(match.json().status).toBe("MATCHED");
    expect(match.json().transactionId).toBe("tx-1");
  });

  it("extrato duplicado não duplica transação", async () => {
    await app.inject({
      method: "POST",
      url: "/api/receipts/statements",
      payload: statement,
    });
    await app.inject({
      method: "POST",
      url: "/api/receipts/statements",
      payload: statement,
    });
    const match = await app.inject({
      method: "POST",
      url: "/api/receipts/match",
      payload: {
        orgId: "org-1",
        amountInCents: 15_000,
        occurredOn: "2026-09-02",
      },
    });
    expect(match.json().status).toBe("MATCHED");
  });

  it("comprovante ambíguo abre ticket e não escolhe sozinho", async () => {
    await app.inject({
      method: "POST",
      url: "/api/receipts/statements",
      payload: statement,
    });
    await app.inject({
      method: "POST",
      url: "/api/receipts/statements",
      payload: { ...statement, transactionId: "tx-2" },
    });
    const match = await app.inject({
      method: "POST",
      url: "/api/receipts/match",
      payload: {
        orgId: "org-1",
        amountInCents: 15_000,
        occurredOn: "2026-09-02",
      },
    });
    expect(match.json().status).toBe("AMBIGUOUS");
    expect(match.json().ticketId).toBeDefined();
    expect(tickets.openTickets()).toHaveLength(1);
  });

  it("sem casamento retorna NO_MATCH com orientação, sem ticket", async () => {
    const match = await app.inject({
      method: "POST",
      url: "/api/receipts/match",
      payload: {
        orgId: "org-1",
        amountInCents: 99_999,
        occurredOn: "2026-09-02",
      },
    });
    expect(match.json().status).toBe("NO_MATCH");
    expect(tickets.openTickets()).toHaveLength(0);
  });

  it("extração inválida dá 400 sem tocar em ticket", async () => {
    const match = await app.inject({
      method: "POST",
      url: "/api/receipts/match",
      payload: { orgId: "org-1", amountInCents: -1, occurredOn: "2026-09-02" },
    });
    expect(match.statusCode).toBe(400);
    expect(tickets.openTickets()).toHaveLength(0);
  });
});
