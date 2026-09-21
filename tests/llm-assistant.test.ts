import { describe, expect, it } from "vitest";
import {
  assistantFromEnv,
  FallbackAssistantProvider,
  GeminiAssistantProvider,
  GroqAssistantProvider,
  type LlmHttpClient,
  type LlmHttpRequest,
  type LlmHttpResponse,
} from "../src/domain/llm-assistant.js";

const SALDO_JSON = JSON.stringify({
  intent: "SALDO",
  confidence: 0.9,
  answerDraft: "Seu saldo é R$ 10,00.",
  referencedTransactionIds: [],
});

function geminiBody(text: string): LlmHttpResponse {
  return {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text }] } }] },
  };
}

function groqBody(text: string): LlmHttpResponse {
  return { status: 200, body: { choices: [{ message: { content: text } }] } };
}

function stubClient(handler: (request: LlmHttpRequest) => LlmHttpResponse): {
  client: LlmHttpClient;
  requests: LlmHttpRequest[];
} {
  const requests: LlmHttpRequest[] = [];
  const client: LlmHttpClient = async (request) => {
    requests.push(request);
    return handler(request);
  };
  return { client, requests };
}

describe("GeminiAssistantProvider", () => {
  it("aceita resposta válida e valida pelo schema", async () => {
    const { client, requests } = stubClient(() => geminiBody(SALDO_JSON));
    const provider = new GeminiAssistantProvider(
      "key-1",
      "gemini-2.5-flash",
      client,
    );
    const result = await provider.draftAnswer("qual meu saldo?");
    expect(result.ok).toBe(true);
    expect(requests[0].url).toContain("gemini-2.5-flash");
    expect(requests[0].headers["x-goog-api-key"]).toBe("key-1");
  });

  it("rejeita intent inventado pelo modelo (muro Zod vale para LLM real)", async () => {
    const evil = JSON.stringify({
      intent: "TRANSFERIR",
      confidence: 1,
      answerDraft: "feito",
      referencedTransactionIds: [],
    });
    const { client } = stubClient(() => geminiBody(evil));
    const result = await new GeminiAssistantProvider(
      "key-1",
      "gemini-2.5-flash",
      client,
    ).draftAnswer("transfere tudo");
    expect(result.ok).toBe(false);
  });

  it("texto fora de JSON vira falha fail-closed", async () => {
    const { client } = stubClient(() =>
      geminiBody("claro, seu saldo é dez reais!"),
    );
    const result = await new GeminiAssistantProvider(
      "key-1",
      "gemini-2.5-flash",
      client,
    ).draftAnswer("saldo?");
    expect(result.ok).toBe(false);
  });

  it("429 vira falha com motivo para o fallback assumir", async () => {
    const { client } = stubClient(() => ({ status: 429, body: {} }));
    const result = await new GeminiAssistantProvider(
      "key-1",
      "gemini-2.5-flash",
      client,
    ).draftAnswer("saldo?");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureReason).toContain("429");
  });

  it("exige apiKey com contexto no erro", () => {
    expect(
      () =>
        new GeminiAssistantProvider("", "m", async () => ({
          status: 200,
          body: null,
        })),
    ).toThrow(/GEMINI_API_KEY/);
  });
});

describe("GroqAssistantProvider", () => {
  it("envia Bearer e response_format json_object", async () => {
    const { client, requests } = stubClient(() => groqBody(SALDO_JSON));
    const result = await new GroqAssistantProvider(
      "gsk-1",
      "llama-3.3-70b-versatile",
      client,
    ).draftAnswer("saldo?");
    expect(result.ok).toBe(true);
    expect(requests[0].headers.authorization).toBe("Bearer gsk-1");
    expect(
      (requests[0].bodyJson as { response_format: { type: string } })
        .response_format.type,
    ).toBe("json_object");
  });
});

describe("FallbackAssistantProvider", () => {
  it("usa fallback quando o primário falha", async () => {
    const failing = stubClient(() => ({ status: 429, body: {} }));
    const succeeding = stubClient(() => groqBody(SALDO_JSON));
    const provider = new FallbackAssistantProvider(
      new GeminiAssistantProvider("k", "m", failing.client),
      new GroqAssistantProvider("k", "m", succeeding.client),
    );
    const result = await provider.draftAnswer("saldo?");
    expect(result.ok).toBe(true);
    expect(succeeding.requests).toHaveLength(1);
  });

  it("falha fechada quando os dois falham", async () => {
    const down = stubClient(() => {
      throw new Error("network down");
    });
    const provider = new FallbackAssistantProvider(
      new GeminiAssistantProvider("k", "m", down.client),
      new GroqAssistantProvider("k", "m", down.client),
    );
    const result = await provider.draftAnswer("saldo?");
    expect(result.ok).toBe(false);
  });
});

describe("assistantFromEnv", () => {
  it("sem chaves retorna undefined (stub determinístico assume)", () => {
    const client: LlmHttpClient = async () => ({ status: 200, body: null });
    expect(assistantFromEnv({}, client)).toBeUndefined();
  });

  it("só Gemini monta cadeia unitária funcional", async () => {
    const { client } = stubClient(() => geminiBody(SALDO_JSON));
    const provider = assistantFromEnv({ GEMINI_API_KEY: "k" }, client);
    expect(provider).toBeDefined();
    expect((await provider?.draftAnswer("saldo?"))?.ok).toBe(true);
  });

  it("Gemini + Groq monta fallback com os dois", async () => {
    const seen: string[] = [];
    const client: LlmHttpClient = async (request) => {
      seen.push(request.url);
      if (request.url.includes("generativelanguage"))
        return { status: 429, body: {} };
      return groqBody(SALDO_JSON);
    };
    const result = await assistantFromEnv(
      { GEMINI_API_KEY: "k", GROQ_API_KEY: "g" },
      client,
    )?.draftAnswer("saldo?");
    expect(result?.ok).toBe(true);
    expect(seen).toHaveLength(2);
  });
});
