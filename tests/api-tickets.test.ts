import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { SupportTicketQueue } from "../src/domain/support-ticket-queue.js";
import { registerTicketsApi } from "../src/http/api-tickets.js";

describe("GET /api/tickets", () => {
  it("lista tickets abertos e o padrão é open", async () => {
    const queue = new SupportTicketQueue();
    queue.open(
      "org-1",
      "CONTESTACAO",
      "cliente discorda da tarifa",
      "2026-09-03T10:00:00Z",
    );
    queue.open("org-1", "GENERAL", "dúvida simples", "2026-09-03T10:05:00Z");
    const app = Fastify();
    await registerTicketsApi(app, { queue });
    await app.ready();
    const open = await app.inject({
      method: "GET",
      url: "/api/tickets?status=open",
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().tickets).toHaveLength(2);
    const implicit = await app.inject({ method: "GET", url: "/api/tickets" });
    expect(implicit.json().tickets).toHaveLength(2);
  });

  it("ticket resolvido sai de open e aparece em all", async () => {
    const queue = new SupportTicketQueue();
    queue.open(
      "org-1",
      "CONTESTACAO",
      "cliente discorda da tarifa",
      "2026-09-03T10:00:00Z",
    );
    const app = Fastify();
    await registerTicketsApi(app, { queue });
    await app.ready();
    const resolved = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/resolve",
      payload: { resolvedBy: "ana", at: "2026-09-03T11:00:00Z" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().ticket.resolvedAtIso).toBe("2026-09-03T11:00:00Z");
    const open = await app.inject({
      method: "GET",
      url: "/api/tickets?status=open",
    });
    expect(open.json().tickets).toHaveLength(0);
    const all = await app.inject({
      method: "GET",
      url: "/api/tickets?status=all",
    });
    expect(all.json().tickets).toHaveLength(1);
  });
});

describe("POST /api/tickets/:id/resolve", () => {
  it("id inexistente retorna 404", async () => {
    const app = Fastify();
    await registerTicketsApi(app, { queue: new SupportTicketQueue() });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-9/resolve",
      payload: { resolvedBy: "ana", at: "2026-09-03T11:00:00Z" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("payload inválido retorna 400", async () => {
    const queue = new SupportTicketQueue();
    queue.open("org-1", "GENERAL", "dúvida simples", "2026-09-03T10:00:00Z");
    const app = Fastify();
    await registerTicketsApi(app, { queue });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/ticket-1/resolve",
      payload: { resolvedBy: "", at: "ontem" },
    });
    expect(response.statusCode).toBe(400);
    expect(queue.openTickets()).toHaveLength(1);
  });
});
