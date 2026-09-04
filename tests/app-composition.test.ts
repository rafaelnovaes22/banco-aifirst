import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createAppContext, registerAllRoutes } from "../src/app-context.js";

describe("app composition", () => {
  it("monta todas as rotas e responde health das APIs", async () => {
    const app = Fastify({ logger: false });
    await registerAllRoutes(app, createAppContext("test-secret"));
    const tickets = await app.inject({
      method: "GET",
      url: "/api/tickets?status=open",
    });
    expect(tickets.statusCode).toBe(200);
    const forecast = await app.inject({
      method: "GET",
      url: "/api/cash-forecast?orgId=ghost&startDate=2026-09-02",
    });
    expect(forecast.statusCode).toBe(404);
    const unknown = await app.inject({ method: "GET", url: "/api/nao-existe" });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it("fluxo fim a fim: KYC bloqueia Pix de conta não operacional", async () => {
    const app = Fastify({ logger: false });
    const context = createAppContext("test-secret");
    await registerAllRoutes(app, context);
    context.gate.register("org-x", "12345678000195");
    const blocked = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: { orgId: "org-x", idempotencyKey: "x-1", amountInCents: 1_000 },
    });
    expect(blocked.statusCode).toBe(403);
    expect(context.ledger.get("x-1")).toBeUndefined();
    await app.close();
  });
});
