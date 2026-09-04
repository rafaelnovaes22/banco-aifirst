import { z } from "zod";

// PORQUÊ: o comprovante vem de OCR/IA, mas o valor que vale é o do ledger.
// A extração só aceita campos mínimos: nada de conta destino ou chave Pix aqui.

const ReceiptExtractionSchema = z.object({
  amountInCents: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  payerName: z.string().max(80).optional(),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

export type ReceiptExtractionParseResult =
  | { readonly ok: true; readonly extraction: ReceiptExtraction }
  | { readonly ok: false; readonly failureReason: string };

export function parseReceiptExtraction(
  raw: unknown,
): ReceiptExtractionParseResult {
  const parsed = ReceiptExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    // PORQUÊ: OCR ruim não pode travar o cliente. Falha vira ticket, nunca exceção solta.
    return {
      ok: false,
      failureReason: `receipt extraction rejected: ${parsed.error.issues[0]?.message ?? "unknown zod issue"}`,
    };
  }
  return { ok: true, extraction: parsed.data };
}
