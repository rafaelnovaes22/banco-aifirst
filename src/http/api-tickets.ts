import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SupportTicketQueue } from "../domain/support-ticket-queue.js";

export interface TicketsApiDeps {
  readonly queue: SupportTicketQueue;
}

const ticketsQuerySchema = z.object({
  status: z.enum(["open", "all"]).optional().default("open"),
});
const ticketParamsSchema = z.object({ id: z.string().min(1) });
const resolveBodySchema = z.object({
  resolvedBy: z.string().min(1),
  at: z.string().datetime({ offset: true }),
});

type TicketsQuery = z.infer<typeof ticketsQuerySchema>;

export async function registerTicketsApi(
  app: FastifyInstance,
  deps: TicketsApiDeps,
): Promise<void> {
  app.get("/api/tickets", async (request, reply) => {
    const parsed = ticketsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "query inválida" });
    return listTicketsReply(app, deps, parsed.data.status);
  });
  app.post("/api/tickets/:id/resolve", async (request, reply) => {
    const params = ticketParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "id inválido" });
    const parsed = resolveBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "payload inválido" });
    return resolveTicketReply(
      app,
      deps,
      params.data.id,
      parsed.data.resolvedBy,
      parsed.data.at,
      reply,
    );
  });
}

function listTicketsReply(
  app: FastifyInstance,
  deps: TicketsApiDeps,
  status: TicketsQuery["status"],
): unknown {
  const tickets =
    status === "all"
      ? [...deps.queue.allTickets()]
      : [...deps.queue.openTickets()];
  app.log.info({ status, ticketCount: tickets.length }, "tickets listados");
  return { status, tickets };
}

function resolveTicketReply(
  app: FastifyInstance,
  deps: TicketsApiDeps,
  ticketId: string,
  resolvedBy: string,
  at: string,
  reply: FastifyReply,
): unknown {
  const ticket = deps.queue.resolve(ticketId, at);
  if (!ticket)
    return reply.code(404).send({ error: `ticket ${ticketId} não encontrado` });
  app.log.info({ ticketId, resolvedBy }, "ticket resolvido");
  return { ticket, resolvedBy };
}
