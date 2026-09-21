import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChargeBook } from "../domain/charge-book.js";
import type { AuditEventInput } from "../domain/audit-ledger.js";

// PORQUÊ: cobrança é o vazamento de caixa número um. Criar, baixar e lembrar
// passam por aqui com trilha PANEL em cada mutação.

export interface ChargesApiDeps {
  readonly charges: ChargeBook;
  readonly auditSink: (input: AuditEventInput) => void;
}

const chargeBodySchema = z.object({
  orgId: z.string().min(1),
  clientName: z.string().min(1).max(120),
  amountInCents: z.number().int().positive(),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});

const chargeIdParamsSchema = z.object({ id: z.string().min(1) });
const todayQuerySchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});

export async function registerChargesApi(
  app: FastifyInstance,
  deps: ChargesApiDeps,
): Promise<void> {
  app.post("/api/charges", async (request, reply) => {
    const parsed = chargeBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "payload inválido" });
    const charge = deps.charges.create(
      parsed.data.orgId,
      parsed.data.clientName,
      parsed.data.amountInCents,
      parsed.data.dueDateIso,
    );
    emitChargeAudit(
      deps,
      charge.orgId,
      "CHARGE_CREATED",
      charge.id,
      charge.amountInCents,
    );
    app.log.info(
      { orgId: charge.orgId, chargeId: charge.id },
      "cobrança criada",
    );
    return reply.code(201).send({ charge });
  });

  app.post("/api/charges/:id/pay", async (request, reply) => {
    const params = chargeIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "id inválido" });
    const charge = deps.charges.markPaid(params.data.id);
    if (!charge)
      return reply
        .code(404)
        .send({ error: `charge ${params.data.id} não encontrada` });
    emitChargeAudit(
      deps,
      charge.orgId,
      "CHARGE_PAID",
      charge.id,
      charge.amountInCents,
    );
    return { charge };
  });

  app.post("/api/charges/:id/cancel", async (request, reply) => {
    const params = chargeIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "id inválido" });
    const charge = deps.charges.cancel(params.data.id);
    if (!charge)
      return reply
        .code(404)
        .send({ error: `charge ${params.data.id} não encontrada` });
    emitChargeAudit(
      deps,
      charge.orgId,
      "CHARGE_CANCELED",
      charge.id,
      charge.amountInCents,
    );
    return { charge };
  });

  app.get("/api/charges/reminders", async (request, reply) => {
    const parsed = todayQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "query inválida, expected ?today=YYYY-MM-DD" });
    const reminders = deps.charges.pendingReminders(parsed.data.today);
    app.log.info(
      { today: parsed.data.today, reminderCount: reminders.length },
      "lembretes consultados",
    );
    return { today: parsed.data.today, reminders };
  });

  app.get("/api/charges/overdue", async (request, reply) => {
    const parsed = todayQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "query inválida, expected ?today=YYYY-MM-DD" });
    const overdue = deps.charges.overdueCharges(parsed.data.today);
    app.log.info(
      { today: parsed.data.today, overdueCount: overdue.length },
      "atrasadas consultadas",
    );
    return { today: parsed.data.today, overdue };
  });
}

function emitChargeAudit(
  deps: ChargesApiDeps,
  orgId: string,
  action: string,
  objectId: string,
  amountInCents: number,
): void {
  deps.auditSink({
    actorId: orgId,
    action,
    objectId,
    channel: "PANEL",
    payloadJson: JSON.stringify({ amountInCents }),
  });
}
