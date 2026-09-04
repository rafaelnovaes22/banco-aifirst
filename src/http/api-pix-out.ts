import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuditEventInput } from "../domain/audit-ledger.js";
import type { BaasProvider } from "../domain/baas-provider.js";
import type { MovementLedger } from "../domain/movement-ledger.js";
import type { OnboardingGate } from "../domain/onboarding-gate.js";
import {
  decidePixOut,
  type MoneyMovementDecision,
} from "../domain/pix-limits.js";
import { executePixOut } from "../domain/pix-out-executor.js";

// PORQUÊ: mfaVerified é opcional porque só importa acima do limiar. amountInCents
// fica como number puro: valor inválido é decisão BLOCKED do domínio, não 400.
const pixOutBodySchema = z.object({
  orgId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  amountInCents: z.number(),
  mfaVerified: z.boolean().optional(),
});

type PixOutBody = z.infer<typeof pixOutBodySchema>;

export interface PixOutApiDeps {
  readonly provider: BaasProvider;
  readonly ledger: MovementLedger;
  readonly gate: OnboardingGate;
  readonly auditSink: (input: AuditEventInput) => void;
}

export async function registerPixOutApi(
  app: FastifyInstance,
  deps: PixOutApiDeps,
): Promise<void> {
  app.post("/api/pix-out", async (request, reply) => {
    const parsed = pixOutBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "payload inválido" });
    return processPixOut(app, deps, parsed.data, reply);
  });
}

async function processPixOut(
  app: FastifyInstance,
  deps: PixOutApiDeps,
  input: PixOutBody,
  reply: FastifyReply,
): Promise<unknown> {
  if (!deps.gate.isAccountOperational(input.orgId))
    return gateBlockedReply(app, deps, input, reply);
  // PORQUÊ: sem fonte de bloqueio de compliance nem outflow acumulado nesta
  // fatia. O gate acima já cobre conta não operacional.
  const decision = decidePixOut({
    orgId: input.orgId,
    amountInCents: input.amountInCents,
    dailyOutflowInCents: 0,
    orgBlocked: false,
  });
  if (decision.kind === "BLOCKED" || decision.kind === "NEEDS_HUMAN_REVIEW")
    return decidedReply(app, deps, input, decision, reply);
  if (decision.kind === "NEEDS_MFA" && input.mfaVerified !== true)
    return decidedReply(app, deps, input, decision, reply);
  return approvedReply(app, deps, input, decision, reply);
}

function gateBlockedReply(
  app: FastifyInstance,
  deps: PixOutApiDeps,
  input: PixOutBody,
  reply: FastifyReply,
): unknown {
  recordPanelAttempt(
    deps,
    input,
    "PIX_OUT_BLOCKED_GATE",
    "conta não operacional para Pix",
  );
  app.log.info(
    { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
    "pix-out barrado no gate",
  );
  return reply.code(403).send({ error: "conta não operacional para Pix" });
}

function decidedReply(
  app: FastifyInstance,
  deps: PixOutApiDeps,
  input: PixOutBody,
  decision: MoneyMovementDecision,
  reply: FastifyReply,
): unknown {
  // PORQUÊ: decisão retida nunca encosta no provider. O evento PANEL prova que nada se moveu.
  recordPanelAttempt(deps, input, `PIX_OUT_${decision.kind}`, decision.reason);
  app.log.info(
    {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      decision: decision.kind,
    },
    "pix-out retido por regra",
  );
  return reply
    .code(200)
    .send({ status: decision.kind, reason: decision.reason });
}

async function approvedReply(
  app: FastifyInstance,
  deps: PixOutApiDeps,
  input: PixOutBody,
  decision: MoneyMovementDecision,
  reply: FastifyReply,
): Promise<unknown> {
  const movement = await executePixOut(
    deps.provider,
    deps.ledger,
    {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      amountInCents: input.amountInCents,
    },
    deps.auditSink,
  );
  recordPanelAttempt(deps, input, "PIX_OUT_EXECUTED", decision.reason);
  app.log.info(
    {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      decision: decision.kind,
    },
    "pix-out executado",
  );
  return reply.code(200).send({
    status: movement.status,
    decision: decision.kind,
    reason: decision.reason,
    movement,
  });
}

function recordPanelAttempt(
  deps: PixOutApiDeps,
  input: PixOutBody,
  action: string,
  reason: string,
): void {
  // PORQUÊ: toda tentativa deixa rastro PANEL mesmo quando o executor também
  // registra o dele (SYSTEM). Auditoria precisa ver a tentativa, não só o desfecho.
  deps.auditSink({
    actorId: input.orgId,
    action,
    objectId: input.idempotencyKey,
    channel: "PANEL",
    payloadJson: JSON.stringify({ reason, amountInCents: input.amountInCents }),
  });
}
