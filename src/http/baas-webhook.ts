import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MovementLedger } from "../domain/movement-ledger.js";

export interface BaasWebhookDeps {
  readonly ledger: MovementLedger;
  readonly webhookSecret: string;
}

export interface AsaasWebhookDeps {
  readonly ledger: MovementLedger;
  readonly webhookToken: string;
}

const BaasWebhookSchema = z.object({
  idempotencyKey: z.string().min(1),
  status: z.enum(["CONFIRMED", "REJECTED"]),
  baasRef: z.string().min(1).optional(),
  amountInCents: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).optional(),
});

type BaasWebhookBody = z.infer<typeof BaasWebhookSchema>;

const AsaasWebhookSchema = z.object({
  event: z.enum(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]),
  payment: z
    .object({
      id: z.string().min(1),
      externalReference: z.string().min(1),
      value: z.union([z.string(), z.number()]).optional(),
      amount: z.union([z.string(), z.number()]).optional(),
      amountInCents: z.number().int().nonnegative().optional(),
      valueInCents: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
});

type AsaasWebhookBody = z.infer<typeof AsaasWebhookSchema>;

export async function registerBaasWebhook(
  app: FastifyInstance,
  deps: BaasWebhookDeps,
): Promise<void> {
  ensureRawBodyParser(app);
  app.post(
    "/webhooks/baas",
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      return settleBaasMovement(app, request, reply, deps);
    },
  );
}

export async function registerAsaasWebhook(
  app: FastifyInstance,
  deps: AsaasWebhookDeps,
): Promise<void> {
  ensureRawBodyParser(app);
  app.post(
    "/webhooks/asaas",
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if (!hasValidAsaasToken(request, deps.webhookToken)) {
        app.log.info({ channel: "SYSTEM", outcome: "UNAUTHORIZED" });
        return reply.code(401).send({ error: "token inválido" });
      }
      const parsed = AsaasWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        app.log.info({ channel: "SYSTEM", outcome: "INVALID_PAYLOAD" });
        return reply.code(400).send({ error: "payload inválido" });
      }
      const mapped: BaasWebhookBody = {
        idempotencyKey: parsed.data.payment.externalReference,
        status: "CONFIRMED",
        baasRef: parsed.data.payment.id,
        amountInCents: toCentsFromAsaas(parsed.data.payment),
      };
      return applyBaasOutcome(app, mapped, deps.ledger, reply);
    },
  );
}

function ensureRawBodyParser(app: FastifyInstance): void {
  // PORQUÊ: o HMAC exige os bytes exatos; o parser padrão descarta o corpo bruto.
  if (app.hasContentTypeParser("application/json"))
    app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    function rawJsonParser(request, body, done): void {
      (request as FastifyRequest & { rawBody?: string }).rawBody =
        body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new Error("corpo JSON inválido"), undefined);
      }
    },
  );
}

async function settleBaasMovement(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BaasWebhookDeps,
): Promise<unknown> {
  // PORQUÊ: assinatura primeiro; ledger intocado em 401 impede forjar confirmação de dinheiro.
  if (!hasValidBaasSignature(request, deps.webhookSecret)) {
    app.log.info({ channel: "SYSTEM", outcome: "UNAUTHORIZED" });
    return reply.code(401).send({ error: "assinatura inválida" });
  }
  const parsed = BaasWebhookSchema.safeParse(request.body);
  if (!parsed.success) {
    app.log.info({ channel: "SYSTEM", outcome: "INVALID_PAYLOAD" });
    return reply.code(400).send({ error: "payload inválido" });
  }
  return applyBaasOutcome(app, parsed.data, deps.ledger, reply);
}

async function applyBaasOutcome(
  app: FastifyInstance,
  body: BaasWebhookBody,
  ledger: MovementLedger,
  reply: FastifyReply,
): Promise<unknown> {
  const current = ledger.get(body.idempotencyKey);
  if (!current) {
    app.log.info({
      idempotencyKey: body.idempotencyKey,
      channel: "SYSTEM",
      outcome: "UNKNOWN_KEY",
    });
    return reply.code(404).send({ error: "chave desconhecida" });
  }
  if (body.status === "REJECTED")
    return failBaasMovement(app, body, ledger, reply);
  return confirmBaasMovement(app, body, ledger, reply);
}

async function confirmBaasMovement(
  app: FastifyInstance,
  body: BaasWebhookBody,
  ledger: MovementLedger,
  reply: FastifyReply,
): Promise<unknown> {
  // PORQUÊ: sem amount não há como checar divergência; mantém PENDING em vez de confirmar no escuro.
  if (body.amountInCents === undefined)
    return reply
      .code(400)
      .send({ error: "amountInCents obrigatório para CONFIRMED" });
  const updated = ledger.markConfirmed(
    body.idempotencyKey,
    body.baasRef ?? "",
    body.amountInCents,
  );
  app.log.info({
    orgId: updated?.orgId,
    idempotencyKey: body.idempotencyKey,
    channel: "SYSTEM",
    outcome: updated?.status,
  });
  return reply
    .code(200)
    .send({ ok: true, status: updated?.status, divergent: updated?.divergent });
}

async function failBaasMovement(
  app: FastifyInstance,
  body: BaasWebhookBody,
  ledger: MovementLedger,
  reply: FastifyReply,
): Promise<unknown> {
  // PORQUÊ: rejeição do BaaS vira FAILED com motivo para a conciliação cobrar, nunca some em silêncio.
  const updated = ledger.markFailed(
    body.idempotencyKey,
    body.reason ?? "baas rejected",
  );
  app.log.info({
    orgId: updated?.orgId,
    idempotencyKey: body.idempotencyKey,
    channel: "SYSTEM",
    outcome: updated?.status,
  });
  return reply.code(200).send({ ok: true, status: updated?.status });
}

function hasValidAsaasToken(request: FastifyRequest, token: string): boolean {
  if (!token) return false;
  const received = request.headers["x-asaas-webhook-token"];
  if (typeof received !== "string" || received.length === 0) return false;
  return timingSafeHexEqual(received, token);
}

function toCentsFromAsaas(payload: AsaasWebhookBody["payment"]): number {
  if (typeof payload.amountInCents === "number") return payload.amountInCents;
  if (typeof payload.valueInCents === "number") return payload.valueInCents;
  if (typeof payload.amount === "number")
    return Math.max(0, Math.round(payload.amount * 100));
  if (typeof payload.value === "number")
    return Math.max(0, Math.round(payload.value * 100));
  if (typeof payload.amount === "string")
    return Math.max(0, Math.round(Number.parseFloat(payload.amount) * 100));
  if (typeof payload.value === "string")
    return Math.max(0, Math.round(Number.parseFloat(payload.value) * 100));
  return 0;
}

function hasValidBaasSignature(
  request: FastifyRequest,
  secret: string,
): boolean {
  const received = request.headers["x-baas-signature"];
  if (typeof received !== "string" || received.length === 0) return false;
  const raw = readRawBody(request);
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeHexEqual(received, expected);
}

function readRawBody(request: FastifyRequest): string {
  // PORQUÊ: fallback stringify cobre inject com objeto; em produção o parser guarda os bytes.
  const raw = (request as FastifyRequest & { rawBody?: unknown }).rawBody;
  if (typeof raw === "string") return raw;
  return JSON.stringify(request.body ?? "");
}

function timingSafeHexEqual(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (receivedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(receivedBytes, expectedBytes);
}
