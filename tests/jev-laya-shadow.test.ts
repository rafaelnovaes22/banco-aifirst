import { describe, expect, it, vi } from "vitest";
import {
  observeLayaDraft,
  routeLaya,
  withJevShadowAnswer,
  type LayaShadowDeps,
} from "../src/domain/jev-intent-check.js";
import type { LayaNoulPair } from "../src/domain/laya-provider.js";

function draftSaldo() {
  return async () =>
    ({
      ok: true,
      intent: "SALDO",
      answerDraft: "rascunho",
      requiresHumanTicket: false,
    }) as const;
}

function layaOf(pair: LayaNoulPair | null | Error): LayaShadowDeps {
  return {
    enabled: true,
    query:
      pair instanceof Error
        ? async () => {
            throw pair;
          }
        : async () => pair,
  };
}

describe("laya shadow (nunca altera o fluxo)", () => {
  it("deriva rota por threshold 0.7", () => {
    expect(routeLaya({ wantsToClose: 0.1, wantsHandoff: 0.9 })).toBe("handoff");
    expect(routeLaya({ wantsToClose: 0.8, wantsHandoff: 0.1 })).toBe("close");
    expect(routeLaya({ wantsToClose: 0.4, wantsHandoff: 0.4 })).toBe(
      "continue",
    );
  });

  it("desligado por default: query nunca chamada", async () => {
    const query = vi.fn(async () => ({ wantsToClose: 0.9, wantsHandoff: 0 }));
    const result = await withJevShadowAnswer(
      draftSaldo(),
      "qual meu saldo?",
      {},
      () => undefined,
      { query },
    );
    expect(result.ok).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it("ligado: loga laya_shadow e preserva o draft", async () => {
    const logs: Record<string, unknown>[] = [];
    const result = await withJevShadowAnswer(
      draftSaldo(),
      "quero falar com um atendente",
      {},
      (fields) => logs.push(fields),
      layaOf({ wantsToClose: 0.05, wantsHandoff: 0.93 }),
    );
    expect(result.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: "laya_shadow",
      mode: "shadow",
      provider: "laya-local",
      layaRoute: "handoff",
    });
  });

  it("marca diverge quando o draft e cego e a rota ve acao", async () => {
    const logs: Record<string, unknown>[] = [];
    const draftDesconhecido = async () =>
      ({
        ok: true,
        intent: "DESCONHECIDO",
        answerDraft: "rascunho",
        requiresHumanTicket: false,
      }) as const;
    await withJevShadowAnswer(
      draftDesconhecido,
      "quero falar com um atendente",
      {},
      (fields) => logs.push(fields),
      layaOf({ wantsToClose: 0.05, wantsHandoff: 0.95 }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(logs[0].diverge).toBe(true);
    expect(logs[0].layaRoute).toBe("handoff");
  });

  it("query nula ou com erro: sem log e sem excecao", async () => {
    for (const deps of [layaOf(null), layaOf(new Error("pesos ausentes"))]) {
      const logs: Record<string, unknown>[] = [];
      const result = await withJevShadowAnswer(
        draftSaldo(),
        "qual meu saldo?",
        {},
        (fields) => logs.push(fields),
        deps,
      );
      expect(result.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      expect(logs).toHaveLength(0);
    }
  });

  it("observeLayaDraft sem query configurada nao faz nada", () => {
    const log = vi.fn();
    observeLayaDraft("oi", "SALDO", {}, log);
    observeLayaDraft("oi", "SALDO", { enabled: true }, log);
    expect(log).not.toHaveBeenCalled();
  });
});
