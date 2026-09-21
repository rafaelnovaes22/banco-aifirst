import { z } from "zod";

// PORQUÊ: o schema é o muro entre a AI e o dinheiro. Não existe campo de valor,
// conta destino ou "transferir" no enum. Tudo que a AI produz se resume a intent
// + rascunho de texto. Intent sensível => ticket humano (fail-closed).

export const ASSISTANT_INTENTS = [
  "SALDO",
  "EXTRATO_RESUMIDO",
  "COBRANCA_CRIAR",
  "TARIFA_DUVIDA",
  "SENHA_RESET",
  "CONTESTACAO",
  "LIMITE_PEDIDO",
  "DESCONHECIDO",
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

const INTENTS_REQUIRING_HUMAN_TICKET: ReadonlySet<AssistantIntent> = new Set([
  "CONTESTACAO",
  "LIMITE_PEDIDO",
]);

const AssistantOutputSchema = z.object({
  intent: z.enum(ASSISTANT_INTENTS),
  confidence: z.number().min(0).max(1),
  answerDraft: z.string().min(1).max(500),
  referencedTransactionIds: z.array(z.string()).max(10),
});

export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export type AssistantOutputParseResult =
  | {
      readonly ok: true;
      readonly intent: AssistantIntent;
      readonly answerDraft: string;
      readonly requiresHumanTicket: boolean;
    }
  | { readonly ok: false; readonly failureReason: string };

export function parseAssistantOutput(raw: unknown): AssistantOutputParseResult {
  const parsed = AssistantOutputSchema.safeParse(raw);
  if (!parsed.success) {
    // PORQUÊ: falha de schema nunca derruba o atendimento. Vira ticket, cliente recebe resposta genérica.
    return {
      ok: false,
      failureReason: `assistant output rejected: ${parsed.error.issues[0]?.message ?? "unknown zod issue"}`,
    };
  }
  return {
    ok: true,
    intent: parsed.data.intent,
    answerDraft: parsed.data.answerDraft,
    requiresHumanTicket: INTENTS_REQUIRING_HUMAN_TICKET.has(parsed.data.intent),
  };
}
