import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { MovementLedger } from "../src/domain/movement-ledger.js";
import { ChargeBook } from "../src/domain/charge-book.js";
import {
  appendAuditEvent,
  type AuditEvent,
} from "../src/domain/audit-ledger.js";
import type { RecurringRule } from "../src/domain/cash-forecast.js";
import { registerReadApi, type ReadApiDeps } from "../src/http/api-read.js";

function seedLedger(): MovementLedger {
  const ledger = new MovementLedger();
  ledger.record(
    { idempotencyKey: "key-1", orgId: "org-1", amountInCents: 1000 },
    "PENDING_CONFIRM",
  );
  ledger.record(
    { idempotencyKey: "key-2", orgId: "org-1", amountInCents: 2500 },
    "CONFIRMED",
    {
      baasRef: "baas-2",
    },
  );
  return ledger;
}

function seedCharges(): ChargeBook {
  const charges = new ChargeBook();
  charges.create("org-1", "Alice", 5000, "2026-09-10");
  charges.create("org-2", "Bob", 7000, "2026-09-11");
  return charges;
}

function seedAuditChain(): AuditEvent[] {
  const chain: AuditEvent[] = [];
  chain.push(
    appendAuditEvent(chain, {
      actorId: "org-1",
      action: "CHARGE_CREATED",
      objectId: "charge-1",
      channel: "PANEL",
      payloadJson: '{"amountInCents":5000}',
    }),
  );
  chain.push(
    appendAuditEvent(chain, {
      actorId: "org-1",
      action: "NOTE",
      objectId: "obj-2",
      channel: "PANEL",
      payloadJson: 'a,"b',
    }),
  );
  return chain;
}

function seedDeps(): ReadApiDeps {
  const rules: RecurringRule[] = [
    {
      orgId: "org-1",
      description: "Aluguel",
      amountInCents: 150_000,
      direction: "OUT",
      dayOfMonth: 5,
    },
  ];
  return {
    ledger: seedLedger(),
    charges: seedCharges(),
    rulesByOrg: new Map([["org-1", rules]]),
    balancesByOrg: new Map([["org-1", 500_000]]),
    auditChain: seedAuditChain(),
  };
}

describe("GET /api/movements", () => {
  it("lista os registros em ordem de inserção", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/movements" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.movements).toHaveLength(2);
    expect(body.movements[0].idempotencyKey).toBe("key-1");
    expect(body.movements[1].idempotencyKey).toBe("key-2");
    expect(body.movements[1].baasRef).toBe("baas-2");
    expect(body.movements[0]).toMatchObject({
      orgId: "org-1",
      amountInCents: 1000,
      divergent: false,
    });
  });
});

describe("GET /api/charges", () => {
  it("filtra cobranças por org", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/charges?orgId=org-1",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.charges).toHaveLength(1);
    expect(body.charges[0].clientName).toBe("Alice");
  });

  it("orgId ausente retorna 400", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/charges" });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/cash-accounts", () => {
  it("org desconhecida retorna 404", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/cash-accounts?orgId=org-9",
    });
    expect(response.statusCode).toBe(404);
  });

  it("retorna saldo e regras públicas", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/cash-accounts?orgId=org-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orgId: "org-1",
      balanceInCents: 500_000,
      rules: [
        {
          description: "Aluguel",
          amountInCents: 150_000,
          direction: "OUT",
          dayOfMonth: 5,
        },
      ],
    });
  });
});

describe("GET /api/audit/export", () => {
  it("json contém os eventos completos", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/audit/export?format=json",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({
      seq: 1,
      action: "CHARGE_CREATED",
      hash: expect.any(String),
    });
  });

  it("csv tem header e escapa vírgula e aspa", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/audit/export?format=csv",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const lines = response.body.split("\n");
    expect(lines[0]).toBe(
      "seq,actorId,action,objectId,channel,baasRef,payloadJson,prevHash,hash",
    );
    expect(response.body).toContain('"a,""b"');
  });

  it("format inválido retorna 400", async () => {
    const app = Fastify();
    await registerReadApi(app, seedDeps());
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/audit/export?format=xml",
    });
    expect(response.statusCode).toBe(400);
  });
});
