import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createHmac } from "node:crypto";
import { registerBaasWebhook } from "../src/http/baas-webhook.js";
import { MovementLedger } from "../src/domain/movement-ledger.js";

const WEBHOOK_SECRET = "segredo-de-teste";

function signBody(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("baas webhook", () => {
  it("assinatura inválida dá 401 sem tocar o ledger", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(
      { idempotencyKey: "idem-1", orgId: "org-1", amountInCents: 10_000 },
      "PENDING_CONFIRM",
    );
    await registerBaasWebhook(app, { ledger, webhookSecret: WEBHOOK_SECRET });
    const raw = JSON.stringify({
      idempotencyKey: "idem-1",
      status: "CONFIRMED",
      baasRef: "baas-1",
      amountInCents: 10_000,
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-baas-signature": "0".repeat(64),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(ledger.get("idem-1")?.status).toBe("PENDING_CONFIRM");
    await app.close();
  });

  it("webhook repetido é idempotente e não altera estado", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(
      { idempotencyKey: "idem-1", orgId: "org-1", amountInCents: 10_000 },
      "PENDING_CONFIRM",
    );
    await registerBaasWebhook(app, { ledger, webhookSecret: WEBHOOK_SECRET });
    const raw = JSON.stringify({
      idempotencyKey: "idem-1",
      status: "CONFIRMED",
      baasRef: "baas-1",
      amountInCents: 10_000,
    });
    const headers = {
      "content-type": "application/json",
      "x-baas-signature": signBody(WEBHOOK_SECRET, raw),
    };
    const first = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers,
    });
    expect(first.statusCode).toBe(200);
    expect(ledger.get("idem-1")?.status).toBe("CONFIRMED");
    const second = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers,
    });
    expect(second.statusCode).toBe(200);
    expect(ledger.get("idem-1")?.status).toBe("CONFIRMED");
    expect(ledger.get("idem-1")?.baasRef).toBe("baas-1");
    await app.close();
  });

  it("valor divergente não confirma e mantém PENDING", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(
      { idempotencyKey: "idem-1", orgId: "org-1", amountInCents: 10_000 },
      "PENDING_CONFIRM",
    );
    await registerBaasWebhook(app, { ledger, webhookSecret: WEBHOOK_SECRET });
    const raw = JSON.stringify({
      idempotencyKey: "idem-1",
      status: "CONFIRMED",
      baasRef: "baas-1",
      amountInCents: 99_999,
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-baas-signature": signBody(WEBHOOK_SECRET, raw),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ledger.get("idem-1")?.status).toBe("PENDING_CONFIRM");
    expect(ledger.get("idem-1")?.divergent).toBe(true);
    await app.close();
  });

  it("chave desconhecida retorna 404", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    await registerBaasWebhook(app, { ledger, webhookSecret: WEBHOOK_SECRET });
    const raw = JSON.stringify({
      idempotencyKey: "chave-fantasma",
      status: "REJECTED",
      reason: "sem saldo",
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-baas-signature": signBody(WEBHOOK_SECRET, raw),
      },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("REJECTED marca FAILED com o motivo do BaaS", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(
      { idempotencyKey: "idem-1", orgId: "org-1", amountInCents: 10_000 },
      "PENDING_CONFIRM",
    );
    await registerBaasWebhook(app, { ledger, webhookSecret: WEBHOOK_SECRET });
    const raw = JSON.stringify({
      idempotencyKey: "idem-1",
      status: "REJECTED",
      reason: "conta bloqueada no BaaS",
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/baas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-baas-signature": signBody(WEBHOOK_SECRET, raw),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ledger.get("idem-1")?.status).toBe("FAILED");
    expect(ledger.get("idem-1")?.failureReason).toContain("bloqueada");
    await app.close();
  });
});
