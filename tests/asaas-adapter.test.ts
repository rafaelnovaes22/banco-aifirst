import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { AsaasBaasProvider } from "../src/domain/baas-provider.js";
import { MovementLedger } from "../src/domain/movement-ledger.js";
import { registerAsaasWebhook } from "../src/http/baas-webhook.js";
import { type PixOutCommand } from "../src/domain/baas-provider.js";

const command: PixOutCommand = {
  idempotencyKey: "idem-asaas-1",
  orgId: "org-1",
  amountInCents: 12_300,
};

type HttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
};

describe("AsaasBaasProvider", () => {
  it("mapeia criação confirmada em Receipt correto", async () => {
    const fetcher = async (
      _url: string,
      init?: Record<string, unknown>,
    ): Promise<HttpResponse> => {
      expect(init?.method).toBe("POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "asaas-123",
          status: "CONFIRMED",
          amountInCents: 12_300,
        }),
      };
    };
    const provider = new AsaasBaasProvider(
      "k",
      "https://api.asaas.test/v3",
      fetcher,
    );
    const receipt = await provider.sendPixOut(command);
    expect(receipt.status).toBe("CONFIRMED");
    if (receipt.status !== "CONFIRMED") {
      throw new Error("esperado RECEIPT confirmado");
    }
    expect(receipt.baasRef).toBe("asaas-123");
    expect(receipt.amountInCents).toBe(12_300);
  });

  it("status de criação assíncrono vira erro e mantém fail-closed no fluxo", async () => {
    const fetcher = async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "asaas-124",
        status: "PENDING",
        amountInCents: 12_300,
      }),
    });
    const provider = new AsaasBaasProvider(
      "k",
      "https://api.asaas.test/v3",
      fetcher,
    );
    await expect(provider.sendPixOut(command)).rejects.toThrow(
      /status assíncrono/,
    );
  });

  it("fetchPixOutStatus trata rejeição do Asaas como FAILED", async () => {
    const fetcher = async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "asaas-125",
        status: "FAILED",
        reason: "blocked",
      }),
    });
    const provider = new AsaasBaasProvider(
      "k",
      "https://api.asaas.test/v3",
      fetcher,
    );
    const receipt = await provider.fetchPixOutStatus("idem-1");
    expect(receipt).not.toBeNull();
    if (receipt === null || receipt.status !== "REJECTED") {
      throw new Error("esperado RECEIPT rejeitado");
    }
    expect(receipt.reason).toContain("blocked");
  });
});

describe("POST /webhooks/asaas", () => {
  it("TOKEN inválido dá 401 e não toca ledger", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(command, "PENDING_CONFIRM");
    await registerAsaasWebhook(app, { ledger, webhookToken: "token-certo" });
    const raw = JSON.stringify({
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "external",
        externalReference: command.idempotencyKey,
        amountInCents: 12_300,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/asaas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-asaas-webhook-token": "token-errado",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(ledger.get(command.idempotencyKey)?.status).toBe("PENDING_CONFIRM");
    await app.close();
  });

  it("PAYMENT_RECEIVED confirma idempotente por PAYMENT event", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(command, "PENDING_CONFIRM");
    await registerAsaasWebhook(app, { ledger, webhookToken: "token-certo" });
    const raw = JSON.stringify({
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "external",
        externalReference: command.idempotencyKey,
        amountInCents: 12_300,
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-asaas-webhook-token": "token-certo",
    };
    const first = await app.inject({
      method: "POST",
      url: "/webhooks/asaas",
      payload: raw,
      headers,
    });
    expect(first.statusCode).toBe(200);
    expect(ledger.get(command.idempotencyKey)?.status).toBe("CONFIRMED");
    const second = await app.inject({
      method: "POST",
      url: "/webhooks/asaas",
      payload: raw,
      headers,
    });
    expect(second.statusCode).toBe(200);
    expect(ledger.get(command.idempotencyKey)?.baasRef).toBe("external");
    await app.close();
  });

  it("payload sem chave retorna 404 sem falha", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    await registerAsaasWebhook(app, { ledger, webhookToken: "token-certo" });
    const raw = JSON.stringify({
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: "external",
        externalReference: "desconhecida",
        amountInCents: 12_300,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/asaas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-asaas-webhook-token": "token-certo",
      },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("valor divergente mantém PENDING", async () => {
    const app = Fastify();
    const ledger = new MovementLedger();
    ledger.record(command, "PENDING_CONFIRM");
    await registerAsaasWebhook(app, { ledger, webhookToken: "token-certo" });
    const raw = JSON.stringify({
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "external",
        externalReference: command.idempotencyKey,
        amountInCents: 9_999,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/asaas",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-asaas-webhook-token": "token-certo",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ledger.get(command.idempotencyKey)?.status).toBe("PENDING_CONFIRM");
    expect(ledger.get(command.idempotencyKey)?.divergent).toBe(true);
    await app.close();
  });
});
