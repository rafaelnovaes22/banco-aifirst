import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { MovementLedger } from "../domain/movement-ledger.js";
import type { ChargeBook } from "../domain/charge-book.js";
import type { AuditEvent } from "../domain/audit-ledger.js";
import type { RecurringRule } from "../domain/cash-forecast.js";

// PORQUÊ: painel de leitura agregado. Só expõe espelhos locais, nunca
// chama o BaaS direto, por isso não recebe provider nem segredo.

export interface ReadApiDeps {
  readonly ledger: MovementLedger;
  readonly charges: ChargeBook;
  readonly rulesByOrg: Map<string, RecurringRule[]>;
  readonly balancesByOrg: Map<string, number>;
  readonly auditChain: readonly AuditEvent[];
}

const orgQuerySchema = z.object({ orgId: z.string().min(1) });
const exportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).optional().default("json"),
});

type OrgQuery = z.infer<typeof orgQuerySchema>;

const CSV_HEADER =
  "seq,actorId,action,objectId,channel,baasRef,payloadJson,prevHash,hash";

export async function registerReadApi(
  app: FastifyInstance,
  deps: ReadApiDeps,
): Promise<void> {
  app.get("/api/movements", async () => listMovementsReply(app, deps));
  app.get("/api/charges", async (request, reply) => {
    const parsed = orgQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "query inválida, expected ?orgId=X" });
    return listChargesReply(app, deps, parsed.data);
  });
  app.get("/api/cash-accounts", async (request, reply) => {
    const parsed = orgQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "query inválida, expected ?orgId=X" });
    return cashAccountReply(app, deps, parsed.data, reply);
  });
  app.get("/api/audit/export", async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "format inválido, expected json|csv" });
    return auditExportReply(app, deps, parsed.data.format, reply);
  });
}

function listMovementsReply(app: FastifyInstance, deps: ReadApiDeps): unknown {
  const movements = deps.ledger.all().map((movement) => ({
    idempotencyKey: movement.idempotencyKey,
    orgId: movement.orgId,
    amountInCents: movement.amountInCents,
    status: movement.status,
    baasRef: movement.baasRef,
    failureReason: movement.failureReason,
    divergent: movement.divergent,
  }));
  app.log.info({ movementCount: movements.length }, "movements listados");
  return { movements };
}

function listChargesReply(
  app: FastifyInstance,
  deps: ReadApiDeps,
  query: OrgQuery,
): unknown {
  const charges = deps.charges.listByOrg(query.orgId);
  app.log.info(
    { orgId: query.orgId, chargeCount: charges.length },
    "charges listadas",
  );
  return { charges };
}

function cashAccountReply(
  app: FastifyInstance,
  deps: ReadApiDeps,
  query: OrgQuery,
  reply: FastifyReply,
): unknown {
  const rules = deps.rulesByOrg.get(query.orgId);
  const balance = deps.balancesByOrg.get(query.orgId);
  if (rules === undefined || balance === undefined) {
    return reply.code(404).send({ error: `org ${query.orgId} desconhecida` });
  }
  app.log.info({ orgId: query.orgId }, "cash account consultada");
  return {
    orgId: query.orgId,
    balanceInCents: balance,
    rules: publicRules(rules),
  };
}

function publicRules(rules: readonly RecurringRule[]): unknown {
  return rules.map((rule) => ({
    description: rule.description,
    amountInCents: rule.amountInCents,
    direction: rule.direction,
    dayOfMonth: rule.dayOfMonth,
  }));
}

function auditExportReply(
  app: FastifyInstance,
  deps: ReadApiDeps,
  format: string,
  reply: FastifyReply,
): unknown {
  if (format === "csv") return auditExportCsvReply(app, deps, reply);
  app.log.info(
    { eventCount: deps.auditChain.length },
    "audit exportado em json",
  );
  return { events: [...deps.auditChain] };
}

function auditExportCsvReply(
  app: FastifyInstance,
  deps: ReadApiDeps,
  reply: FastifyReply,
): unknown {
  const lines = deps.auditChain.map((event) => auditEventToCsvLine(event));
  app.log.info({ eventCount: lines.length }, "audit exportado em csv");
  return reply
    .header("Content-Type", "text/csv")
    .send([CSV_HEADER, ...lines].join("\n"));
}

function auditEventToCsvLine(event: AuditEvent): string {
  const cells = [
    event.seq,
    event.actorId,
    event.action,
    event.objectId,
    event.channel,
    event.baasRef ?? "",
    event.payloadJson,
    event.prevHash,
    event.hash,
  ];
  return cells.map((cell) => csvEscapeCell(cell)).join(",");
}

function csvEscapeCell(cell: string | number): string {
  return `"${String(cell).replaceAll('"', '""')}"`;
}
