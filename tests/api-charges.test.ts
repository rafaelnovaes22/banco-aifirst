import { describe, expect, it, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ChargeBook } from "../src/domain/charge-book.js";
import {
  registerChargesApi,
  type ChargesApiDeps,
} from "../src/http/api-charges.js";
import type { AuditEventInput } from "../src/domain/audit-ledger.js";

function buildApp(): { app: FastifyInstance; audited: AuditEventInput[] } {
  const app = Fastify({ logger: false });
  const audited: AuditEventInput[] = [];
  const deps: ChargesApiDeps = {
    charges: new ChargeBook(),
    auditSink: (input) => {
      audited.push(input);
    },
  };
  void registerChargesApi(app, deps);
  return { app, audited };
}

describe("charges API", () => {
  let app: FastifyInstance;
  let audited: AuditEventInput[];

  beforeEach(() => {
    ({ app, audited } = buildApp());
  });

  it("cria cobrança com 201 e registra trilha", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/charges",
      payload: {
        orgId: "org-1",
        clientName: "Maria",
        amountInCents: 15_000,
        dueDateIso: "2026-09-10",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().charge.id).toBe("charge-1");
    expect(audited.map((event) => event.action)).toEqual(["CHARGE_CREATED"]);
  });

  it("rejeita valor inválido com 400 sem criar nada", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/charges",
      payload: {
        orgId: "org-1",
        clientName: "Maria",
        amountInCents: -5,
        dueDateIso: "2026-09-10",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(audited).toHaveLength(0);
  });

  it("baixa cobrança e some dos lembretes", async () => {
    await app.inject({
      method: "POST",
      url: "/api/charges",
      payload: {
        orgId: "org-1",
        clientName: "Maria",
        amountInCents: 15_000,
        dueDateIso: "2026-09-10",
      },
    });
    const paid = await app.inject({
      method: "POST",
      url: "/api/charges/charge-1/pay",
    });
    expect(paid.json().charge.status).toBe("PAID");
    const reminders = await app.inject({
      method: "GET",
      url: "/api/charges/reminders?today=2026-09-08",
    });
    expect(reminders.json().reminders).toHaveLength(0);
  });

  it("baixar cobrança inexistente dá 404", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/charges/ghost/pay",
    });
    expect(response.statusCode).toBe(404);
  });

  it("lembrete D-2 aparece na consulta", async () => {
    await app.inject({
      method: "POST",
      url: "/api/charges",
      payload: {
        orgId: "org-1",
        clientName: "Maria",
        amountInCents: 15_000,
        dueDateIso: "2026-09-10",
      },
    });
    const reminders = await app.inject({
      method: "GET",
      url: "/api/charges/reminders?today=2026-09-08",
    });
    expect(reminders.json().reminders[0].reminderKind).toBe("D_MINUS_2");
  });

  it("atrasadas aparecem na consulta de overdue", async () => {
    await app.inject({
      method: "POST",
      url: "/api/charges",
      payload: {
        orgId: "org-1",
        clientName: "Maria",
        amountInCents: 15_000,
        dueDateIso: "2026-09-10",
      },
    });
    const overdue = await app.inject({
      method: "GET",
      url: "/api/charges/overdue?today=2026-09-15",
    });
    expect(overdue.json().overdue).toHaveLength(1);
  });
});
