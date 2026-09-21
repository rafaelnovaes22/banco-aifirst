import { z } from "zod";
import {
  ASSISTANT_INTENTS,
  type AssistantIntent,
  type AssistantOutputParseResult,
} from "./assistant-output-schema.js";

// PORQUÊ: segunda opinião calibrada sobre o intent do assistente (stub ou LLM).
// O confidence do JSON do LLM é auto-nota sem calibração; o Jev devolve choice
// com probabilidades calibradas mais um noul independente para intents sensíveis.
// Shadow-first: nunca altera fluxo, nunca abre ticket, nunca toca em dinheiro.
// Entrada é sempre texto já mascarado (redacted); PII bruta nunca sai daqui.

export const JEV_MODEL_PINNED = "jev-1.13.0";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MAX_STATE_CHARS = 2000;
export const JEV_DEFAULT_TIMEOUT_MS = 2000;

const ACT = 0.7;
const ESCALATE_BELOW = 0.5;

export const SENSITIVE_INTENTS: ReadonlySet<AssistantIntent> = new Set([
  "CONTESTACAO",
  "LIMITE_PEDIDO",
]);

export interface JevIntentCheck {
  readonly choice: AssistantIntent;
  readonly choiceConfidence: number;
  readonly sensitiveNoul: number;
  readonly sensitive: boolean;
  readonly escalate: boolean;
  readonly model: string;
  readonly latencyMs: number;
  readonly mocked: false;
}

export interface JevCheckDeps {
  readonly fetchImpl?: typeof fetch;
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly enabled?: boolean;
}

export type JevCheckLog = (fields: Record<string, unknown>) => void;

type DraftFn = (redactedText: string) => Promise<AssistantOutputParseResult>;

const INTENT_CRITERIA: Record<AssistantIntent, string> = {
  SALDO: "Asks for the current account balance or available money.",
  EXTRATO_RESUMIDO: "Asks for a statement or summary of recent transactions.",
  COBRANCA_CRIAR: "Asks to create a charge or boleto to receive money.",
  TARIFA_DUVIDA: "Asks about fees, tariffs, or service charges.",
  SENHA_RESET: "Asks to reset or recover a password.",
  CONTESTACAO: "Disputes a charge or claims an undue cobrança.",
  LIMITE_PEDIDO: "Asks for a higher credit or transaction limit.",
  DESCONHECIDO: "None of the other intents apply.",
};

function isPrintable(code: number): boolean {
  return (code >= 32 && code < 127) || code >= 160;
}

export function sanitizeStateText(raw: string): string {
  if (!raw) return "";
  const clean = [...raw]
    .filter((ch) => isPrintable(ch.codePointAt(0) ?? 32))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= JEV_MAX_STATE_CHARS) return clean;
  return clean.slice(0, JEV_MAX_STATE_CHARS);
}

export function isJevConfigured(apiKey?: string): boolean {
  if (!apiKey || apiKey.length < 8) return false;
  if (apiKey.includes("...")) return false;
  return true;
}

function buildCheckBody(state: string, model: string): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const intent of ASSISTANT_INTENTS)
    criteria[intent] = INTENT_CRITERIA[intent];
  return {
    state,
    model,
    questions: {
      intent: {
        type: "choice",
        instructions: "Which banking intent matches the customer message?",
        criteria,
      },
      sensitive: {
        type: "noul",
        instructions:
          "The message disputes a charge or asks for a higher credit or transaction limit.",
      },
    },
  };
}

const JevCheckResponse = z.object({
  model: z.string().optional(),
  answers: z.object({
    intent: z.object({
      choice: z.string(),
      confidence: z.number().optional(),
      probabilities: z.record(z.string(), z.number()).optional(),
    }),
    sensitive: z.object({ noul: z.number() }),
  }),
});

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isAssistantIntent(value: string): value is AssistantIntent {
  return (ASSISTANT_INTENTS as readonly string[]).includes(value);
}

interface ParsedCheck {
  readonly choice: AssistantIntent;
  readonly choiceConfidence: number;
  readonly sensitiveNoul: number;
  readonly model: string;
}

function parseCheckResponse(body: unknown): ParsedCheck | null {
  const parsed = JevCheckResponse.safeParse(body);
  if (!parsed.success) return null;
  if (!isAssistantIntent(parsed.data.answers.intent.choice)) return null;
  return {
    choice: parsed.data.answers.intent.choice,
    choiceConfidence: clamp01(parsed.data.answers.intent.confidence, 0.5),
    sensitiveNoul: clamp01(parsed.data.answers.sensitive.noul, 0.5),
    model: parsed.data.model ?? JEV_MODEL_PINNED,
  };
}

async function postCheck(
  fetchImpl: typeof fetch,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ParsedCheck | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseCheckResponse(await res.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function queryJevIntentCheck(
  redactedText: string,
  deps: JevCheckDeps = {},
): Promise<JevIntentCheck | null> {
  if (deps.enabled !== true) return null;
  const apiKey = deps.apiKey ?? "";
  if (!isJevConfigured(apiKey)) return null;
  const state = sanitizeStateText(redactedText);
  if (!state) return null;
  const start = Date.now();
  const out = await postCheck(
    deps.fetchImpl ?? fetch,
    apiKey,
    buildCheckBody(state, deps.model ?? JEV_MODEL_PINNED),
    deps.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS,
  );
  if (!out) return null;
  const distance = Math.abs(out.choiceConfidence - 0.5) * 2;
  return {
    ...out,
    sensitive: out.sensitiveNoul >= ACT,
    escalate:
      (out.choiceConfidence >= ESCALATE_BELOW && out.choiceConfidence < ACT) ||
      distance < ESCALATE_BELOW,
    latencyMs: Date.now() - start,
    mocked: false,
  };
}

export function observeDraft(
  redactedText: string,
  draftedIntent: AssistantIntent,
  deps: JevCheckDeps,
  log: JevCheckLog,
): void {
  void queryJevIntentCheck(redactedText, deps).then((check) => {
    if (!check) return;
    const disagree = check.choice !== draftedIntent;
    const tripwire = check.sensitive && !SENSITIVE_INTENTS.has(draftedIntent);
    if (!disagree && !tripwire) return;
    log({
      area: "jev",
      event: "shadow_divergence",
      mode: "shadow",
      draftedIntent,
      jevChoice: check.choice,
      jevConfidence: check.choiceConfidence,
      sensitiveNoul: check.sensitiveNoul,
      escalate: check.escalate,
      model: check.model,
      latencyMs: check.latencyMs,
      msgChars: redactedText.length,
    });
  });
}

export async function withJevShadowAnswer(
  draft: DraftFn,
  redactedText: string,
  deps: JevCheckDeps,
  log: JevCheckLog,
): Promise<AssistantOutputParseResult> {
  const result = await draft(redactedText);
  if (result.ok) observeDraft(redactedText, result.intent, deps, log);
  return result;
}
