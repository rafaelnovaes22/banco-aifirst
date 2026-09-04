import { screenInboundMessage } from "../domain/prompt-injection-screen.js";
import { redactForPrompt } from "../domain/pii-redaction.js";
import type {
  AssistantIntent,
  AssistantOutputParseResult,
} from "../domain/assistant-output-schema.js";
import type {
  SupportTicketQueue,
  TicketReason,
} from "../domain/support-ticket-queue.js";
import type { AuditChannel, AuditEventInput } from "../domain/audit-ledger.js";

// PORQUÊ: WhatsApp e Telegram respondem igual. O núcleo (máscara, screening,
// draft, ticket, auditoria) vive aqui. Canal novo reaproveita sem duplicar.

export type InboundChannel = Extract<AuditChannel, "WHATSAPP" | "TELEGRAM">;

export interface InboundMessage {
  readonly orgId: string;
  readonly channel: InboundChannel;
  readonly contactRef: string;
  readonly text: string;
}

export interface InboundAssistantDeps {
  readonly tickets: SupportTicketQueue;
  readonly auditSink: (input: AuditEventInput) => void;
  readonly answerDraft: (
    redactedText: string,
  ) => Promise<AssistantOutputParseResult>;
}

export type InboundReply =
  | { readonly replyKind: "GENERIC"; readonly ticketId: string }
  | {
      readonly replyKind: "DRAFT";
      readonly intent: AssistantIntent;
      readonly answerDraft: string;
    }
  | { readonly replyKind: "TICKET"; readonly ticketId: string };

export async function answerInboundMessage(
  message: InboundMessage,
  deps: InboundAssistantDeps,
): Promise<InboundReply> {
  const redacted = redactForPrompt(message.text);
  const screening = screenInboundMessage(redacted);
  if (screening.suspicious)
    return blockInjectionAttempt(
      message,
      redacted,
      screening.matchedLabels,
      deps,
    );
  return draftAssistantAnswer(message, redacted, deps);
}

function blockInjectionAttempt(
  message: InboundMessage,
  redacted: string,
  labels: readonly string[],
  deps: InboundAssistantDeps,
): InboundReply {
  // PORQUÊ: o texto bruto nunca entra no ticket; só os labels, para não persistir ataque nem PII.
  const ticket = deps.tickets.open(
    message.orgId,
    "INJECTION_SUSPECTED",
    `mensagem bloqueada: ${labels.join(", ")}`,
    new Date().toISOString(),
  );
  emitInboundAudit(message, redacted, deps, "INJECTION_BLOCKED", ticket.id);
  return { replyKind: "GENERIC", ticketId: ticket.id };
}

async function draftAssistantAnswer(
  message: InboundMessage,
  redacted: string,
  deps: InboundAssistantDeps,
): Promise<InboundReply> {
  const drafted = await deps.answerDraft(redacted);
  if (!drafted.ok) return parkAssistantFailure(message, redacted, deps);
  if (drafted.requiresHumanTicket)
    return parkSensitiveIntent(message, redacted, drafted.intent, deps);
  emitInboundAudit(message, redacted, deps, "DRAFT_ANSWERED", message.orgId);
  return {
    replyKind: "DRAFT",
    intent: drafted.intent,
    answerDraft: drafted.answerDraft,
  };
}

function parkSensitiveIntent(
  message: InboundMessage,
  redacted: string,
  intent: AssistantIntent,
  deps: InboundAssistantDeps,
): InboundReply {
  // PORQUÊ: contestação e limite mexem com dinheiro e regra; só humano resolve, a AI só rascunha.
  const ticket = deps.tickets.open(
    message.orgId,
    ticketReasonForIntent(intent),
    `intent ${intent} requer atendimento humano`,
    new Date().toISOString(),
  );
  emitInboundAudit(message, redacted, deps, "TICKET_OPENED", ticket.id);
  return { replyKind: "TICKET", ticketId: ticket.id };
}

function parkAssistantFailure(
  message: InboundMessage,
  redacted: string,
  deps: InboundAssistantDeps,
): InboundReply {
  // PORQUÊ: schema inválido nunca derruba o atendimento; vira ticket e resposta genérica.
  const ticket = deps.tickets.open(
    message.orgId,
    "GENERAL",
    "resposta do assistente rejeitada pelo schema",
    new Date().toISOString(),
  );
  emitInboundAudit(message, redacted, deps, "ASSISTANT_REJECTED", ticket.id);
  return { replyKind: "GENERIC", ticketId: ticket.id };
}

function emitInboundAudit(
  message: InboundMessage,
  redacted: string,
  deps: InboundAssistantDeps,
  outcome: string,
  objectId: string,
): void {
  // PORQUÊ: auditoria guarda texto e contato mascarados, nunca PII bruta (telefone pode ser chave Pix).
  const maskedContact = redactForPrompt(message.contactRef);
  const payloadJson = JSON.stringify({
    outcome,
    redactedText: redacted,
    contactRef: maskedContact,
  });
  deps.auditSink({
    actorId: `${message.channel}:${maskedContact}`,
    action: message.channel,
    objectId,
    channel: message.channel,
    payloadJson,
  });
}

function ticketReasonForIntent(intent: AssistantIntent): TicketReason {
  // PORQUÊ: só CONTESTACAO e LIMITE_PEDIDO exigem ticket hoje; GENERAL protege intenção futura.
  if (intent === "CONTESTACAO") return "CONTESTACAO";
  if (intent === "LIMITE_PEDIDO") return "LIMITE_PEDIDO";
  return "GENERAL";
}
