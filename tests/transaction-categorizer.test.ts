import { describe, expect, it } from "vitest";
import {
  suggestCategory,
  TransactionCategorizer,
} from "../src/domain/transaction-categorizer.js";

describe("suggestCategory", () => {
  it("regra determinística categoriza aluguel", () => {
    expect(suggestCategory("Aluguel do studio")).toEqual({
      category: "ALUGUEL",
      source: "RULE",
    });
  });

  it("regra determinística categoriza insumo", () => {
    expect(suggestCategory("Compra de tinta 7.0")).toEqual({
      category: "INSUMOS",
      source: "RULE",
    });
  });

  it("descrição sem regra cai em OUTROS sem sugestão firme", () => {
    expect(suggestCategory("transferencia aleatoria")).toEqual({
      category: "OUTROS",
      source: "NONE",
    });
  });
});

describe("TransactionCategorizer", () => {
  it("registra transação com sugestão pendente de confirmação humana", () => {
    const categorizer = new TransactionCategorizer();
    const transaction = categorizer.register("tx-1", "Anúncio Instagram");
    expect(transaction.suggestedCategory).toBe("MARKETING");
    expect(categorizer.pendingConfirmation()).toHaveLength(1);
  });

  it("usuário humano confirma em 1 toque e sai da fila de pendentes", () => {
    const categorizer = new TransactionCategorizer();
    categorizer.register("tx-1", "Anúncio Instagram");
    const confirmed = categorizer.confirmCategory(
      "tx-1",
      "MARKETING",
      "user-42",
    );
    expect(confirmed?.confirmedCategory).toBe("MARKETING");
    expect(confirmed?.confirmedByUserId).toBe("user-42");
    expect(categorizer.pendingConfirmation()).toHaveLength(0);
  });

  it("ator de IA não consegue confirmar categoria (guardrail técnico)", () => {
    const categorizer = new TransactionCategorizer();
    categorizer.register("tx-1", "Aluguel do studio");
    expect(() =>
      categorizer.confirmCategory("tx-1", "ALUGUEL", "ai-assistant-7"),
    ).toThrow(/cannot confirm category/);
    expect(categorizer.pendingConfirmation()).toHaveLength(1);
  });
});
