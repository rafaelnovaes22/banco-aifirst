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
  const only = candidates[0];
  if (!only) return { kind: "NO_MATCH" };
  return { kind: "UNIQUE", transactionId: only.id };
}

export interface BaixaUnica {
  readonly transactionId: string;
  readonly amountInCents: number;
}

export interface LoteClassificado {
  readonly unicas: number;
  readonly semMatch: number;
  readonly idsAmbiguos: readonly string[];
  readonly baixasUnicas: readonly BaixaUnica[];
}

// PORQUÊ: lote puro sem cadeia: o Node anexa trilha com hash, o navegador usa
// a trilha do pages-store. Valor e data decidem nos dois, sem duplicar regra.
export function classificarLote(
  extracoes: readonly ReceiptExtraction[],
  espelhos: readonly TransactionMirror[],
): LoteClassificado {
  let unicas = 0;
  let semMatch = 0;
  const ambiguos: string[] = [];
  const baixasUnicas: BaixaUnica[] = [];
  for (const extracao of extracoes) {
    const match = matchReceiptToTransactions(extracao, espelhos);
    if (match.kind === "UNIQUE") {
      unicas += 1;
      baixasUnicas.push({
        transactionId: match.transactionId,
        amountInCents: extracao.amountInCents,
      });
    } else if (match.kind === "AMBIGUOUS") {
      ambiguos.push(...match.transactionIds);
    } else {
      semMatch += 1;
    }
  }
  return {
    unicas,
    semMatch,
    idsAmbiguos: [...new Set(ambiguos)],
    baixasUnicas,
  };
}
