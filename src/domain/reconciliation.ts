import type { BaasProvider } from "./baas-provider.js";
import type { MovementLedger, LedgerMovement } from "./movement-ledger.js";

// PORQUÊ: webhook pode se perder. Polling de 15 min varre os pendentes e
// fecha o estado real no BaaS. Divergente segue para humano, nunca auto-confirma.

export interface ReconciliationReport {
  readonly confirmed: number;
  readonly failed: number;
  readonly stillPending: number;
  readonly divergentKeys: readonly string[];
}

export async function reconcilePendingMovements(
  provider: BaasProvider,
  ledger: MovementLedger,
): Promise<ReconciliationReport> {
  let confirmed = 0;
  let failed = 0;
  let stillPending = 0;
  const divergentKeys: string[] = [];
  for (const movement of ledger.pendingMovements()) {
    if (movement.divergent) {
      divergentKeys.push(movement.idempotencyKey);
      continue;
    }
    const receipt = await provider.fetchPixOutStatus(movement.idempotencyKey);
    if (!receipt) {
      stillPending += 1;
      continue;
    }
    if (receipt.status === "REJECTED") {
      ledger.markFailed(movement.idempotencyKey, receipt.reason);
      failed += 1;
      continue;
    }
    const updated: LedgerMovement | undefined = ledger.markConfirmed(
      movement.idempotencyKey,
      receipt.baasRef,
      receipt.amountInCents,
    );
    if (updated?.divergent) divergentKeys.push(movement.idempotencyKey);
    else confirmed += 1;
  }
  return { confirmed, failed, stillPending, divergentKeys };
}
