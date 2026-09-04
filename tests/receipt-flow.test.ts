import { describe, expect, it } from "vitest";
import { parseReceiptExtraction } from "../src/domain/receipt-extraction.js";
import {
  matchReceiptToTransactions,
  type TransactionMirror,
} from "../src/domain/receipt-matcher.js";

const transactions: readonly TransactionMirror[] = [
  {
    id: "tx-in-1",
    amountInCents: 15_000,
    direction: "IN",
    occurredOn: "2026-09-02",
  },
  {
    id: "tx-in-2",
    amountInCents: 15_000,
    direction: "IN",
    occurredOn: "2026-09-03",
  },
  {
    id: "tx-out-1",
    amountInCents: 15_000,
    direction: "OUT",
    occurredOn: "2026-09-02",
  },
  {
    id: "tx-in-3",
    amountInCents: 9_999,
    direction: "IN",
    occurredOn: "2026-09-02",
  },
];

describe("comprovante: extração e casamento", () => {
  it("aceita extração válida", () => {
    const result = parseReceiptExtraction({
      amountInCents: 15_000,
      occurredOn: "2026-09-02",
      payerName: "Maria Souza",
    });
    expect(result.ok).toBe(true);
  });

  it("rejeita extração com valor negativo ou quebrado", () => {
    expect(
      parseReceiptExtraction({ amountInCents: -1, occurredOn: "2026-09-02" })
        .ok,
    ).toBe(false);
    expect(
      parseReceiptExtraction({ amountInCents: 10.5, occurredOn: "2026-09-02" })
        .ok,
    ).toBe(false);
  });

  it("rejeita data fora do formato ISO curto", () => {
    const result = parseReceiptExtraction({
      amountInCents: 100,
      occurredOn: "02/09/2026",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureReason).toContain("rejected");
  });

  it("casa comprovante único por valor e data", () => {
    const extraction = parseReceiptExtraction({
      amountInCents: 9_999,
      occurredOn: "2026-09-02",
    });
    if (!extraction.ok) throw new Error("unexpected extraction failure");
    const match = matchReceiptToTransactions(
      extraction.extraction,
      transactions,
    );
    expect(match.kind).toBe("UNIQUE");
    if (match.kind === "UNIQUE") expect(match.transactionId).toBe("tx-in-3");
  });

  it("ignora transação de saída com mesmo valor (comprovante é de entrada)", () => {
    const extraction = parseReceiptExtraction({
      amountInCents: 15_000,
      occurredOn: "2026-09-10",
    });
    if (!extraction.ok) throw new Error("unexpected extraction failure");
    expect(
      matchReceiptToTransactions(extraction.extraction, transactions).kind,
    ).toBe("NO_MATCH");
  });

  it("dois recebimentos iguais no mesmo dia viram AMBIGUOUS (humano decide)", () => {
    const extraction = parseReceiptExtraction({
      amountInCents: 15_000,
      occurredOn: "2026-09-02",
    });
    if (!extraction.ok) throw new Error("unexpected extraction failure");
    const match = matchReceiptToTransactions(
      extraction.extraction,
      transactions,
    );
    expect(match.kind).toBe("AMBIGUOUS");
    if (match.kind === "AMBIGUOUS")
      expect(match.transactionIds).toEqual(["tx-in-1", "tx-in-2"]);
  });

  it("tolera diferença de 1 dia entre comprovante e transação", () => {
    const extraction = parseReceiptExtraction({
      amountInCents: 9_999,
      occurredOn: "2026-09-01",
    });
    if (!extraction.ok) throw new Error("unexpected extraction failure");
    expect(
      matchReceiptToTransactions(extraction.extraction, transactions).kind,
    ).toBe("UNIQUE");
  });
});
