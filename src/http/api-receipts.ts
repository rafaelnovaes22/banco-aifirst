import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseReceiptExtraction } from "../domain/receipt-extraction.js";
import {
  matchReceiptToTransactions,
  type TransactionMirror,
} from "../domain/receipt-matcher.js";
import type { SupportTicketQueue } from "../domain/support-ticket-queue.js";
import type { AuditEventInput } from "../domain/audit-ledger.js";

// PORQUÊ: o comprovante casa com o extrato espelhado do BaaS por valor e data.
// UNIQUE anexa sozinho. AMBIGUOUS vira ticket humano. NO_MATCH orienta a
// ressincronizar o extrato em vez de forçar um casamento errado.

export interface ReceiptsApiDeps {
  readonly statementsByOrg: Map<string, TransactionMirror[]>;
  readonly tickets: SupportTicketQueue;
  readonly auditSink: (input: AuditEventInput) => void;
}

const statementBodySchema = z.object({
  orgId: z.string().min(1),
  transactionId: z.string().min(1),
  amountInCents: z.number().int().positive(),
  direction: z.enum(["IN", "OUT"]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});

const matchBodySchema = z.object({
  orgId: z.string().min(1),
  amountInCents: z.number(),
  occurredOn: z.string(),
  payerName: z.string().max(80).optional(),
});

export async function registerReceiptsApi(
  app: FastifyInstance,
  deps: ReceiptsApiDeps,
): Promise<void> {
  app.post("/api/receipts/statements", async (request, reply) => {
    const parsed = statementBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "payload inválido" });
    const transaction: TransactionMirror = {
      id: parsed.data.transactionId,
      amountInCents: parsed.data.amountInCents,
      direction: parsed.data.direction,
      occurredOn: parsed.data.occurredOn,
    };
    const statement = deps.statementsByOrg.get(parsed.data.orgId) ?? [];
    if (!statement.some((existing) => existing.id === transaction.id))
      statement.push(transaction);
    deps.statementsByOrg.set(parsed.data.orgId, statement);
    return reply.code(201).send({ transaction });
  });

  app.post("/api/receipts/match", async (request, reply) => {
    const parsed = matchBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "payload inválido" });
    const extraction = parseReceiptExtraction({
      amountInCents: parsed.data.amountInCents,
      occurredOn: parsed.data.occurredOn,
      payerName: parsed.data.payerName,
    });
    if (!extraction.ok)
      return reply.code(400).send({ error: extraction.failureReason });
    const statement = deps.statementsByOrg.get(parsed.data.orgId) ?? [];
    const match = matchReceiptToTransactions(extraction.extraction, statement);
    deps.auditSink({
      actorId: parsed.data.orgId,
      action: `RECEIPT_${match.kind}`,
      objectId: parsed.data.orgId,
      channel: "PANEL",
      payloadJson: JSON.stringify({
        amountInCents: extraction.extraction.amountInCents,
        occurredOn: extraction.extraction.occurredOn,
      }),
    });
    if (match.kind === "AMBIGUOUS") {
      const ticket = deps.tickets.open(
        parsed.data.orgId,
        "RECEIPT_AMBIGUOUS",
        `comprovante casa com ${match.transactionIds.length} transações`,
        new Date().toISOString(),
      );
      app.log.info(
        { orgId: parsed.data.orgId, ticketId: ticket.id },
        "comprovante ambíguo, ticket aberto",
      );
      return {
        status: "AMBIGUOUS",
        ticketId: ticket.id,
        transactionIds: match.transactionIds,
      };
    }
    if (match.kind === "UNIQUE")
      return { status: "MATCHED", transactionId: match.transactionId };
    return {
      status: "NO_MATCH",
      hint: "ressincronize o extrato e tente de novo",
    };
  });
}
