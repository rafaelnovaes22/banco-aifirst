import {
  parseAssistantOutput,
  type AssistantOutputParseResult,
} from "./assistant-output-schema.js";

// PORQUÊ: adapter fino para tier gratuita. Gemini Flash primário, Groq de fallback.
// Qualquer falha (429, timeout, JSON inválido, intent fora do enum) vira ok:false
// e o chamador abre ticket humano. Nenhum caminho aqui move dinheiro.

export interface LlmHttpRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly bodyJson: unknown;
}

export interface LlmHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type LlmHttpClient = (
  request: LlmHttpRequest,
) => Promise<LlmHttpResponse>;

export interface AssistantProvider {
  draftAnswer(redactedText: string): Promise<AssistantOutputParseResult>;
}

const ASSISTANT_SYSTEM_PROMPT = [
  "Você é o assistente do Fluxo Conta no WhatsApp.",
  "Responda SEMPRE com JSON válido, sem markdown, neste formato exato:",
  '{"intent":"SALDO","confidence":0.9,"answerDraft":"texto curto em pt-BR","referencedTransactionIds":[]}',
  "Intents permitidas: SALDO, EXTRATO_RESUMIDO, COBRANCA_CRIAR, TARIFA_DUVIDA, SENHA_RESET, CONTESTACAO, LIMITE_PEDIDO, DESCONHECIDO.",
  "Regras: nunca invente valores ou saldos; pedido de transferência, limite ou contestação usa o intent correspondente com rascunho neutro; answerDraft em no máximo 2 frases.",
].join(" ");

function requestFailure(
  provider: string,
  reason: string,
): AssistantOutputParseResult {
  return { ok: false, failureReason: `${provider} indisponível: ${reason}` };
}

function extractGeminiText(body: unknown): string | undefined {
  // PORQUÊ: validação manual por guardas. Zod aqui seria overkill para um envelope_mutável do Google.
  if (typeof body !== "object" || body === null) return undefined;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const parts = (
    candidates[0] as { content?: { parts?: { text?: unknown }[] } }
  ).content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.length > 0 ? text : undefined;
}

function extractOpenAiText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const choices = (body as { choices?: { message?: { content?: unknown } }[] })
    .choices;
  const content = Array.isArray(choices)
    ? choices[0]?.message?.content
    : undefined;
  return typeof content === "string" && content.length > 0
    ? content
    : undefined;
}

function parseModelJson(
  provider: string,
  text: string,
): AssistantOutputParseResult {
  try {
    // PORQUÊ: o muro Zod decide. JSON válido com intent inventado continua rejeitado.
    return parseAssistantOutput(JSON.parse(text) as unknown);
  } catch {
    return requestFailure(provider, "resposta fora do formato JSON esperado");
  }
}

export class GeminiAssistantProvider implements AssistantProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly http: LlmHttpClient,
  ) {
    if (!apiKey)
      throw new Error(
        "GeminiAssistantProvider requires non-empty apiKey (env GEMINI_API_KEY)",
      );
  }

  async draftAnswer(redactedText: string): Promise<AssistantOutputParseResult> {
    try {
      const response = await this.http({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        bodyJson: {
          contents: [
            {
              parts: [
                {
                  text: `${ASSISTANT_SYSTEM_PROMPT}\n\nMensagem: ${redactedText}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 300,
          },
        },
      });
      if (response.status === 429)
        return requestFailure("gemini", "rate limited (429), fallback assume");
      if (response.status < 200 || response.status >= 300)
        return requestFailure("gemini", `http ${response.status}`);
      const text = extractGeminiText(response.body);
      if (!text)
        return requestFailure("gemini", "resposta sem texto utilizável");
      return parseModelJson("gemini", text);
    } catch (error) {
      return requestFailure("gemini", String(error));
    }
  }
}

export class GroqAssistantProvider implements AssistantProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly http: LlmHttpClient,
  ) {
    if (!apiKey)
      throw new Error(
        "GroqAssistantProvider requires non-empty apiKey (env GROQ_API_KEY)",
      );
  }

  async draftAnswer(redactedText: string): Promise<AssistantOutputParseResult> {
    try {
      const response = await this.http({
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        bodyJson: {
          model: this.model,
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            { role: "user", content: redactedText },
          ],
          response_format: { type: "json_object" },
          max_tokens: 300,
        },
      });
      if (response.status === 429)
        return requestFailure("groq", "rate limited (429)");
      if (response.status < 200 || response.status >= 300)
        return requestFailure("groq", `http ${response.status}`);
      const text = extractOpenAiText(response.body);
      if (!text) return requestFailure("groq", "resposta sem texto utilizável");
      return parseModelJson("groq", text);
    } catch (error) {
      return requestFailure("groq", String(error));
    }
  }
}

export class FallbackAssistantProvider implements AssistantProvider {
  constructor(
    private readonly primary: AssistantProvider,
    private readonly fallback: AssistantProvider,
  ) {}

  async draftAnswer(redactedText: string): Promise<AssistantOutputParseResult> {
    const first = await this.primary.draftAnswer(redactedText);
    if (first.ok) return first;
    return this.fallback.draftAnswer(redactedText);
  }
}

export interface LlmEnv {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
  readonly GROQ_API_KEY?: string;
  readonly GROQ_MODEL?: string;
}

export function assistantFromEnv(
  env: LlmEnv,
  http: LlmHttpClient,
): AssistantProvider | undefined {
  // PORQUÊ: sem chave não há provedor; o chamador mantém o stub determinístico. Custo R$0 até ter chave free.
  const providers: AssistantProvider[] = [];
  if (env.GEMINI_API_KEY)
    providers.push(
      new GeminiAssistantProvider(
        env.GEMINI_API_KEY,
        env.GEMINI_MODEL ?? "gemini-2.5-flash",
        http,
      ),
    );
  if (env.GROQ_API_KEY)
    providers.push(
      new GroqAssistantProvider(
        env.GROQ_API_KEY,
        env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        http,
      ),
    );
  if (providers.length === 0) return undefined;
  return providers.reduce(
    (primary, fallback) => new FallbackAssistantProvider(primary, fallback),
  );
}

export function fetchJsonHttpClient(timeoutMs = 10_000): LlmHttpClient {
  return async (request: LlmHttpRequest): Promise<LlmHttpResponse> => {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.bodyJson),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  };
}
