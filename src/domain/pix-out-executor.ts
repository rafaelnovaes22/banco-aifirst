import type { BaasProvider, PixOutCommand } from "./baas-provider.js";
import { MovementLedger, type LedgerMovement } from "./movement-ledger.js";
import type { AuditEventInput } from "./audit-ledger.js";

// PORQUÊ: único ponto do sistema que chama sendPixOut. Recebe comando já
// aprovado pelo motor de regras (decidePixOut) e registra tudo na trilha.

export type AuditSink = (input: AuditEventInput) => void;

function auditInput(
  command: PixOutCommand,
  action: string,
  baasRef?: string,
): AuditEventInput {
  return {
    actorId: command.orgId,
    action,
    objectId: command.idempotencyKey,
    channel: "SYSTEM",
    baasRef,
    payloadJson: JSON.stringify({
      amountInCents: command.amountInCents,
      orgId: command.orgId,
    }),
  };
}

export async function executePixOut(
  provider: BaasProvider,
  ledger: MovementLedger,
  command: PixOutCommand,
  auditSink: AuditSink,
): Promise<LedgerMovement> {
  const existing = ledger.get(command.idempotencyKey);
  if (existing) return existing;
  try {
    const receipt = await provider.sendPixOut(command);
    if (receipt.status === "REJECTED") {
      auditSink(auditInput(command, "PIX_OUT_REJECTED"));
      return ledger.record(command, "REJECTED", {
        failureReason: receipt.reason,
      });
    }
    if (receipt.amountInCents !== command.amountInCents) {
      // PORQUÊ: o BaaS confirmou valor diferente do enviado. Fail-closed: pendente + divergente, humano decide.
      auditSink(
        auditInput(command, "PIX_OUT_DIVERGENT_AMOUNT", receipt.baasRef),
      );
      return ledger.record(command, "PENDING_CONFIRM", {
        baasRef: receipt.baasRef,
        failureReason: `divergent amount: sent ${command.amountInCents}c, baas confirmed ${receipt.amountInCents}c`,
        divergent: true,
      });
    }
    auditSink(auditInput(command, "PIX_OUT_CONFIRMED", receipt.baasRef));
    return ledger.record(command, "CONFIRMED", { baasRef: receipt.baasRef });
  } catch (error) {
    // PORQUÊ: exceção nunca vira sucesso presumido. Vira pendente até a reconciliação decidir.
    auditSink(auditInput(command, "PIX_OUT_PENDING_AFTER_ERROR"));
    return ledger.record(command, "PENDING_CONFIRM", {
      failureReason: String(error),
    });
  }
}
