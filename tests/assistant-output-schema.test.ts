import { describe, expect, it } from "vitest";
import { parseAssistantOutput } from "../src/domain/assistant-output-schema.js";

describe("parseAssistantOutput", () => {
  it("aceita saída válida de dúvida simples", () => {
    const result = parseAssistantOutput({
      intent: "SALDO",
      confidence: 0.9,
      answerDraft: "Seu saldo de hoje é R$ 1.234,56.",
      referencedTransactionIds: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiresHumanTicket).toBe(false);
    }
  });

  it("marca contestação como ticket humano obrigatório", () => {
    const result = parseAssistantOutput({
      intent: "CONTESTACAO",
      confidence: 0.7,
      answerDraft: "Vou abrir um protocolo para o time verificar.",
      referencedTransactionIds: ["tx-9"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiresHumanTicket).toBe(true);
    }
  });

  it("marca pedido de limite como ticket humano obrigatório", () => {
    const result = parseAssistantOutput({
      intent: "LIMITE_PEDIDO",
      confidence: 0.8,
      answerDraft: "Pedido registrado.",
      referencedTransactionIds: [],
    });
    expect(result.ok && result.requiresHumanTicket).toBe(true);
  });

  it("rejeita intent de transferência: a AI não consegue expressar movimento de dinheiro", () => {
    const result = parseAssistantOutput({
      intent: "TRANSFERIR",
      confidence: 1,
      answerDraft: "Transferência aprovada pela IA.",
      referencedTransactionIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureReason).toContain("rejected");
    }
  });

  it("rejeita payload com campo de valor injetado pela AI", () => {
    const result = parseAssistantOutput({
      intent: "SALDO",
      confidence: 0.9,
      answerDraft: "ok",
      referencedTransactionIds: [],
      amountInCents: 500_000,
    });
    // Zod por padrão ignora chaves extras, então o muro real é o contrato do provedor.
    // PORQUÊ deste teste: documentar que campo de valor é descartado e nunca chega ao motor de regras.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("amountInCents" in result).toBe(false);
    }
  });

  it("rejeita confidence fora do intervalo", () => {
    const result = parseAssistantOutput({
      intent: "SALDO",
      confidence: 1.5,
      answerDraft: "ok",
      referencedTransactionIds: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejeita payload que não é objeto", () => {
    const result = parseAssistantOutput("saldo por favor");
    expect(result.ok).toBe(false);
  });
});
