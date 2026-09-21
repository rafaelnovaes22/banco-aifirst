import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { registerApiRoutes } from "./api-routes.js";
import { BankApplication } from "./bank-application.js";
import type { BankRepository } from "./repository.js";
import { RuntimeError } from "./runtime-error.js";
import { registerStaticRoutes } from "./static-routes.js";

export interface BankServerConfig {
  readonly appOrigin: string;
  readonly cookieName: string;
  readonly secureCookie: boolean;
  readonly staticRoot?: string;
  readonly logger?: boolean;
}

export async function buildBankServer(
  repository: BankRepository,
  config: BankServerConfig,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logger ?? false,
    trustProxy: (_address: string, hop: number): boolean => hop < 1,
    bodyLimit: 16_384,
  });
  registerEmptyFormParser(app);
  app.decorateRequest("bankSession", null);
  app.addHook("onRequest", securityHeaders(config.secureCookie));
  app.addHook("onClose", async () => repository.close());
  app.setErrorHandler(runtimeErrorHandler);
  app.get("/health", async (_request, reply) => health(repository, reply));
  registerApiRoutes(app, new BankApplication(repository), config);
  if (config.staticRoot) await registerStaticRoutes(app, config.staticRoot);
  return app;
}

function registerEmptyFormParser(app: FastifyInstance): void {
  // PORQUÊ: alguns clientes HTTP marcam POST vazio como form; a rota de sessão não usa o corpo.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
}

function securityHeaders(secure: boolean) {
  return async (
    request: FastifyRequest,
    reply: { header(name: string, value: string): unknown },
  ): Promise<void> => {
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", contentSecurityPolicy());
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    if (secure)
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
  };
}

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

async function health(
  repository: BankRepository,
  reply: { code(status: number): unknown },
): Promise<object> {
  const database = await repository.health().catch(() => false);
  if (!database) reply.code(503);
  return {
    status: database ? "ok" : "degraded",
    database: database ? "reachable" : "unreachable",
  };
}

function runtimeErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof RuntimeError) {
    reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.id,
      },
    });
    return;
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    reply.code(error.statusCode).send({
      error: {
        code: "REQUEST_REJECTED",
        message: "A solicitação não pôde ser processada.",
        requestId: request.id,
      },
    });
    return;
  }
  request.log.error({
    event: "request_failed",
    requestId: request.id,
    error: error.message,
  });
  reply.code(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Não foi possível concluir a solicitação.",
      requestId: request.id,
    },
  });
}
