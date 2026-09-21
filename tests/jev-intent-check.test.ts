import { describe, expect, it, vi } from "vitest";
import {
  isJevConfigured,
  observeDraft,
  queryJevIntentCheck,
  sanitizeStateText,
  withJevShadowAnswer,
} from "../src/domain/jev-intent-check.js";

function jevBody(choice: string, noul: number, confidence = 0.9): Response {
  return new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        intent: { choice, confidence },
        sensitive: { noul },
      },
    }),
    { status: 200 },
  );
}

function fetchOf(response: Response | Error): typeof fetch {
  if (response instanceof Error) {
    return vi.fn(async () => {
      throw response;
    }) as unknown as typeof fetch;
  }
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe("jev-intent-check (shadow-safe)", () => {
  it("sanitiza e trunca state longo", () => {
    expect(sanitizeStateText("  saldo   atual ")).toBe("saldo atual");
    expect(sanitizeStateText("a".repeat(2500)).length).toBe(2000);
    expect(sanitizeStateText("")).toBe("");
  });

  it("rejeita chave ausente ou placeholder", () => {
    expect(isJevConfigured("")).toBe(false);
    expect(isJevConfigured("ts-...")).toBe(false);
    expect(isJevConfigured("chave-real-123")).toBe(true);
  });

  it("retorna null quando desabilitado", async () => {
    const out = await queryJevIntentCheck("qual meu saldo?", {
      apiKey: "chave-real-123",
    });
    expect(out).toBeNull();
  });

  it("parseia choice e noul do fetch mockado", async () => {
    const out = await queryJevIntentCheck("qual meu saldo?", {
      apiKey: "chave-real-123",
      fetchImpl: fetchOf(jevBody("SALDO", 0.02)),
      timeoutMs: 1000,
      enabled: true,
    });
    expect(out?.choice).toBe("SALDO");
    expect(out?.sensitive).toBe(false);
    expect(out?.escalate).toBe(false);
    expect(out?.model).toBe("jev-1.13.0");
    expect(out?.mocked).toBe(false);
  });

  it("marca sensível quando o noul passa do act", async () => {
    const out = await queryJevIntentCheck("quero contestar a cobrança", {
      apiKey: "chave-real-123",
      fetchImpl: fetchOf(jevBody("CONTESTACAO", 0.94)),
      timeoutMs: 1000,
      enabled: true,
    });
    expect(out?.choice).toBe("CONTESTACAO");
    expect(out?.sensitive).toBe(true);
  });

  it("nunca lança em falha de rede, 429 ou timeout", async () => {
    const hanging = vi.fn(
      (_url: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;
    const cases: [string, typeof fetch][] = [
      ["erro", fetchOf(new Error("boom"))],
      ["429", fetchOf(new Response("rate", { status: 429 }))],
      ["timeout", hanging],
      ["json-invalido", fetchOf(new Response("nao-json", { status: 200 }))],
      ["choice-inventado", fetchOf(jevBody("TRANSFERIR_TUDO", 0.1))],
    ];
    for (const [name, fetchImpl] of cases) {
      const out = await queryJevIntentCheck("qual meu saldo?", {
        apiKey: "chave-real-123",
        fetchImpl,
        timeoutMs: 50,
        enabled: true,
      });
      expect(out, name).toBeNull();
    }
  });

  it("retorna null em state vazio sem chamar rede", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await queryJevIntentCheck("   ", {
      apiKey: "chave-real-123",
      fetchImpl,
      timeoutMs: 500,
      enabled: true,
    });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("observeDraft só loga divergência ou tripwire sensível", async () => {
    const logs: Record<string, unknown>[] = [];
    const log = (fields: Record<string, unknown>): void => {
      logs.push(fields);
    };
    const deps = {
      apiKey: "chave-real-123",
      fetchImpl: fetchOf(jevBody("SALDO", 0.02)),
      timeoutMs: 1000,
      enabled: true,
    };
    observeDraft("qual meu saldo?", "SALDO", deps, log);
    await new Promise((r) => setTimeout(r, 50));
    expect(logs).toHaveLength(0);

    const sensitive = {
      ...deps,
      fetchImpl: fetchOf(jevBody("CONTESTACAO", 0.9)),
    };
    observeDraft("quero contestar a cobrança", "SALDO", sensitive, log);
    await new Promise((r) => setTimeout(r, 50));
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe("shadow_divergence");
  });

  it("withJevShadowAnswer preserva o draft e observa em paralelo", async () => {
    const draft = async () =>
      ({
        ok: true,
        intent: "SALDO",
        answerDraft: "rascunho",
        requiresHumanTicket: false,
      }) as const;
    const logs: Record<string, unknown>[] = [];
    const result = await withJevShadowAnswer(
      draft,
      "qual meu saldo?",
      {
        apiKey: "chave-real-123",
        fetchImpl: fetchOf(jevBody("CONTESTACAO", 0.9)),
        timeoutMs: 1000,
        enabled: true,
      },
      (fields) => logs.push(fields),
    );
    expect(result.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(logs).toHaveLength(1);
  });
});
