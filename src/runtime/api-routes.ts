import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { SessionIdentity } from "./contracts.js";
import type { BankApplication } from "./bank-application.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { RuntimeError } from "./runtime-error.js";
import {
  isTrustedOrigin,
  parseCookie,
  serializeSessionCookie,
} from "./session-security.js";

declare module "fastify" {
  interface FastifyRequest {
    bankSession: SessionIdentity | null;
  }
}

export interface ApiRuntimeConfig {
  readonly appOrigin: string;
  readonly cookieName: string;
  readonly secureCookie: boolean;
}

const commandSchema = z.object({ text: z.string().min(1).max(1_000) }).strict();
const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function registerApiRoutes(
  app: FastifyInstance,
  bank: BankApplication,
  config: ApiRuntimeConfig,
): void {
  const limiter = new FixedWindowRateLimiter(120, 60_000);
  const authenticate = createAuthenticationHook(bank, config.cookieName);
  const authorizeMutation = createMutationHook(bank, config.appOrigin);
  app.addHook("onRequest", createRateLimitHook(limiter));
  app.post("/api/v1/session", async (request, reply) =>
    startSession(request, reply, bank, config),
  );
  app.get("/api/v1/cockpit", { preHandler: authenticate }, async (request) =>
    bank.cockpit(requireSession(request)),
  );
  app.post(
    "/api/v1/commands",
    { preHandler: [authenticate, authorizeMutation] },
    async (request) =>
      bank.command(
        requireSession(request),
        parseBody(commandSchema, request.body).text,
        requireIdempotency(request),
        new Date(),
      ),
  );
  app.post(
    "/api/v1/approvals/:id/decisions",
    { preHandler: [authenticate, authorizeMutation] },
    async (request) => approvalDecision(request, bank),
  );
  app.get("/api/v1/audit", { preHandler: authenticate }, async (request) =>
    bank.audit(requireSession(request)),
  );
  app.get(
    "/api/v1/audit/export",
    { preHandler: authenticate },
    async (request, reply) => exportAudit(request, reply, bank),
  );
}

function createRateLimitHook(limiter: FixedWindowRateLimiter) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!request.url.startsWith("/api/")) return;
    const result = limiter.consume(request.ip, new Date());
    reply.header("X-RateLimit-Limit", "120");
    if (result.allowed) return;
    reply.header("Retry-After", String(result.retryAfterSeconds));
    throw new RuntimeError(
      429,
      "RATE_LIMITED",
      "Muitas solicitações. Aguarde antes de tentar novamente.",
    );
  };
}

function createAuthenticationHook(bank: BankApplication, cookieName: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = parseCookie(request.headers.cookie, cookieName);
    const identity = token ? await bank.authenticate(token, new Date()) : null;
    if (!identity)
      throw new RuntimeError(
        401,
        "SESSION_REQUIRED",
        "Inicie uma sessão segura para continuar.",
      );
    request.bankSession = identity;
  };
}

function createMutationHook(bank: BankApplication, appOrigin: string) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!isTrustedOrigin(request.headers.origin, appOrigin)) {
      throw new RuntimeError(
        403,
        "ORIGIN_REJECTED",
        "A origem da operação não foi autorizada.",
      );
    }
    const csrf = singleHeader(request.headers["x-csrf-token"]);
    if (!csrf)
      throw new RuntimeError(
        403,
        "CSRF_REQUIRED",
        "O token de proteção da sessão está ausente.",
      );
    await bank.authorizeMutation(requireSession(request), csrf, new Date());
  };
}

async function startSession(
  request: FastifyRequest,
  reply: FastifyReply,
  bank: BankApplication,
  config: ApiRuntimeConfig,
): Promise<unknown> {
  if (
    request.headers.origin &&
    !isTrustedOrigin(request.headers.origin, config.appOrigin)
  )
    throw new RuntimeError(
      403,
      "ORIGIN_REJECTED",
      "A origem da sessão não foi autorizada.",
    );
  const existingToken = parseCookie(request.headers.cookie, config.cookieName);
  const started = await bank.startSession(existingToken, new Date());
  reply.header(
    "Set-Cookie",
    serializeSessionCookie(
      config.cookieName,
      started.sessionToken,
      config.secureCookie,
    ),
  );
  reply.header("Cache-Control", "no-store");
  return { csrfToken: started.csrfToken, session: started.session };
}

async function approvalDecision(
  request: FastifyRequest,
  bank: BankApplication,
): Promise<unknown> {
  const params = request.params as { id?: unknown };
  const approvalId = parseApprovalId(params.id);
  const body = parseBody(decisionSchema, request.body);
  return bank.approvalDecision(
    requireSession(request),
    approvalId,
    body.decision,
    body.expectedVersion,
    requireIdempotency(request),
    new Date(),
  );
}

function parseApprovalId(value: unknown): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success)
    throw new RuntimeError(
      400,
      "INVALID_APPROVAL_ID",
      "A aprovação informada não é válida.",
    );
  return parsed.data;
}

async function exportAudit(
  request: FastifyRequest,
  reply: FastifyReply,
  bank: BankApplication,
): Promise<string> {
  const csv = await bank.auditCsv(requireSession(request));
  reply.type("text/csv; charset=utf-8");
  reply.header(
    "Content-Disposition",
    'attachment; filename="fluxo-auditoria.csv"',
  );
  reply.header("Cache-Control", "no-store");
  return csv;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new RuntimeError(
      400,
      "INVALID_BODY",
      "Os dados enviados não são válidos.",
    );
  return result.data;
}

function requireIdempotency(request: FastifyRequest): string {
  const key = singleHeader(request.headers["idempotency-key"]);
  if (!key || !idempotencyPattern.test(key)) {
    throw new RuntimeError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Envie uma chave idempotente válida para esta ação.",
    );
  }
  return key;
}

function requireSession(request: FastifyRequest): SessionIdentity {
  if (!request.bankSession)
    throw new RuntimeError(401, "SESSION_REQUIRED", "A sessão segura expirou.");
  return request.bankSession;
}

function singleHeader(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
