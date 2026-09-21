import type { ReceiptExtraction } from "./receipt-extraction.js";

// PORQUÊ: casamento comprovante-transação é por valor e data (±1 dia por fuso
// do cliente). Nunca pelo texto extraído. Ambíguo sobe para humano.

export interface TransactionMirror {
  readonly id: string;
  readonly amountInCents: number;
  readonly direction: "IN" | "OUT";
  readonly occurredOn: string;
}

export type ReceiptMatch =
  | { readonly kind: "UNIQUE"; readonly transactionId: string }
  | { readonly kind: "AMBIGUOUS"; readonly transactionIds: readonly string[] }
  | { readonly kind: "NO_MATCH" };

function dayNumber(dateIso: string): number {
  return Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000);
}

export function matchReceiptToTransactions(
  extraction: ReceiptExtraction,
  transactions: readonly TransactionMirror[],
): ReceiptMatch {
  const extractionDay = dayNumber(extraction.occurredOn);
  const candidates = transactions.filter((transaction) => {
    if (
      transaction.direction !== "IN" ||
      transaction.amountInCents !== extraction.amountInCents
    )
      return false;
    return Math.abs(dayNumber(transaction.occurredOn) - extractionDay) <= 1;
  });
  if (candidates.length === 0) return { kind: "NO_MATCH" };
  if (candidates.length > 1)
    return {
      kind: "AMBIGUOUS",
      transactionIds: candidates.map((candidate) => candidate.id),
    };
  return { kind: "UNIQUE", transactionId: candidates[0].id };
}
