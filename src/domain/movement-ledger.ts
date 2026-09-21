// PORQUÊ: espelho local dos movimentos do BaaS. Idempotência por chave garante
// que webhook reenviado ou retry nunca duplique dinheiro.

export type MovementStatus =
  "PENDING_CONFIRM" | "CONFIRMED" | "FAILED" | "REJECTED";

export interface MovementCommand {
  readonly idempotencyKey: string;
  readonly orgId: string;
  readonly amountInCents: number;
}

export interface LedgerMovement extends MovementCommand {
  readonly status: MovementStatus;
  readonly baasRef?: string;
  readonly failureReason?: string;
  readonly divergent: boolean;
}

export interface MovementRecordDetails {
  readonly baasRef?: string;
  readonly failureReason?: string;
  readonly divergent?: boolean;
}

export class MovementLedger {
  private readonly movementsByKey = new Map<string, LedgerMovement>();

  get(idempotencyKey: string): LedgerMovement | undefined {
    return this.movementsByKey.get(idempotencyKey);
  }

  pendingMovements(): LedgerMovement[] {
    return [...this.movementsByKey.values()].filter(
      (movement) => movement.status === "PENDING_CONFIRM",
    );
  }

  all(): readonly LedgerMovement[] {
    return [...this.movementsByKey.values()];
  }

  record(
    command: MovementCommand,
    status: MovementStatus,
    details: MovementRecordDetails = {},
  ): LedgerMovement {
    const existing = this.movementsByKey.get(command.idempotencyKey);
    if (existing) return existing;
    const movement: LedgerMovement = {
      ...command,
      status,
      divergent: details.divergent ?? false,
      baasRef: details.baasRef,
      failureReason: details.failureReason,
    };
    this.movementsByKey.set(command.idempotencyKey, movement);
    return movement;
  }

  markConfirmed(
    idempotencyKey: string,
    baasRef: string,
    actualAmountInCents: number,
  ): LedgerMovement | undefined {
    const movement = this.movementsByKey.get(idempotencyKey);
    if (!movement || movement.status === "CONFIRMED") return movement;
    // PORQUÊ: valor divergente não auto-confirma. Fica pendente com flag para humano decidir.
    const divergent = actualAmountInCents !== movement.amountInCents;
    const updated: LedgerMovement = divergent
      ? { ...movement, baasRef, divergent }
      : { ...movement, baasRef, status: "CONFIRMED", divergent: false };
    this.movementsByKey.set(idempotencyKey, updated);
    return updated;
  }

  markFailed(
    idempotencyKey: string,
    reason: string,
  ): LedgerMovement | undefined {
    const movement = this.movementsByKey.get(idempotencyKey);
    if (!movement || movement.status === "CONFIRMED") return movement;
    const updated: LedgerMovement = {
      ...movement,
      status: "FAILED",
      failureReason: reason,
    };
    this.movementsByKey.set(idempotencyKey, updated);
    return updated;
  }
}
