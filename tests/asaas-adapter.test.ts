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
  pixAddressKey: "f825a844-7a31-4b36-91b1-2e1ffed60a6e",
  pixAddressKeyType: "EVP",
};

type HttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
};

type HttpRequestInit = {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
};

describe("AsaasBaasProvider", () => {
  it("mapeia criação confirmada em Receipt correto", async () => {
    let requestedUrl = "";
    let requestedInit: HttpRequestInit | undefined;
    const fetcher = async (
      url: string,
      init?: HttpRequestInit,
    ): Promise<HttpResponse> => {
      requestedUrl = url;
      requestedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "asaas-123",
          status: "DONE",
          value: 123,
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
    expect(requestedUrl).toBe("https://api.asaas.test/v3/transfers");
    expect(requestedInit?.method).toBe("POST");
    expect(requestedInit?.headers).toMatchObject({
      access_token: "k",
      "User-Agent": "BancoAIFirst/0.1.0 (Node.js; sandbox)",
      "content-type": "application/json",
    });
    expect(requestedInit?.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(requestedInit?.body ?? "{}")).toEqual({
      value: 123,
      pixAddressKey: command.pixAddressKey,
      pixAddressKeyType: command.pixAddressKeyType,
      externalReference: command.idempotencyKey,
    });
  });

  it("usa a API Sandbox oficial quando baseUrl não é informada", async () => {
    let requestedUrl = "";
    const fetcher = async (url: string): Promise<HttpResponse> => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "asaas-sandbox", status: "DONE", value: 123 }),
      };
    };
    const provider = new AsaasBaasProvider("k", undefined, fetcher);
    await provider.sendPixOut(command);
    expect(requestedUrl).toBe("https://api-sandbox.asaas.com/v3/transfers");
  });

  it("status de criação assíncrono vira erro e mantém fail-closed no fluxo", async () => {
    const fetcher = async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "asaas-124",
        status: "PENDING",
        value: 123,
      }),
    });
    const provider = new AsaasBaasProvider(
      "k",
      "https://api.asaas.test/v3",
      fetcher,
    );
    await expect(provider.sendPixOut(command)).rejects.toThrow(
      /asaas-124.*PENDING/,
    );
  });

  it("fetchPixOutStatus trata rejeição do Asaas como FAILED", async () => {
    let requestedUrl = "";
    let requestedInit: HttpRequestInit | undefined;
    const fetcher = async (
      url: string,
      init?: HttpRequestInit,
    ): Promise<HttpResponse> => {
      requestedUrl = url;
      requestedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "asaas-125",
          status: "FAILED",
          value: 123,
          failReason: "blocked",
        }),
      };
    };
    const provider = new AsaasBaasProvider(
      "k",
      "https://api.asaas.test/v3",
      fetcher,
    );
    const receipt = await provider.fetchPixOutStatus("asaas-125");
    expect(receipt).not.toBeNull();
    if (receipt === null || receipt.status !== "REJECTED") {
      throw new Error("esperado RECEIPT rejeitado");
    }
    expect(receipt.reason).toContain("blocked");
    expect(requestedUrl).toBe("https://api.asaas.test/v3/transfers/asaas-125");
    expect(requestedInit?.method).toBe("GET");
    expect(requestedInit?.body).toBeUndefined();
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
