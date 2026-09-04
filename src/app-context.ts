import type { FastifyInstance } from "fastify";
import {
  AsaasBaasProvider,
  SandboxBaasProvider,
  type BaasProvider,
} from "./domain/baas-provider.js";
import { MovementLedger } from "./domain/movement-ledger.js";
import { OnboardingGate } from "./domain/onboarding-gate.js";
import { ConsentLedger } from "./domain/consent-ledger.js";
import { SupportTicketQueue } from "./domain/support-ticket-queue.js";
import {
  appendAuditEvent,
  type AuditEvent,
  type AuditEventInput,
} from "./domain/audit-ledger.js";
import { parseAssistantOutput } from "./domain/assistant-output-schema.js";
import {
  assistantFromEnv,
  fetchJsonHttpClient,
  type LlmEnv,
} from "./domain/llm-assistant.js";
import type { RecurringRule } from "./domain/cash-forecast.js";
import { ChargeBook } from "./domain/charge-book.js";
import type { TransactionMirror } from "./domain/receipt-matcher.js";
import { registerWhatsappWebhook } from "./http/whatsapp-webhook.js";
import { registerBaasWebhook } from "./http/baas-webhook.js";
import { registerAsaasWebhook } from "./http/baas-webhook.js";
import { registerPixOutApi } from "./http/api-pix-out.js";
import { registerCashApi } from "./http/api-cash.js";
import { registerTicketsApi } from "./http/api-tickets.js";
import { registerChargesApi } from "./http/api-charges.js";
import { registerReadApi } from "./http/api-read.js";
import { registerReceiptsApi } from "./http/api-receipts.js";
import { registerTelegramWebhook } from "./http/telegram-webhook.js";

// PORQUÊ: único lugar que monta dependências. Rotas recebem tudo injetado,
// nenhum módulo HTTP instancia parceiro ou estado global sozinho.

export interface AppContext {
  readonly provider: BaasProvider;
  readonly ledger: MovementLedger;
  readonly gate: OnboardingGate;
  readonly consents: ConsentLedger;
  readonly tickets: SupportTicketQueue;
  readonly auditChain: AuditEvent[];
  readonly rulesByOrg: Map<string, RecurringRule[]>;
  readonly balancesByOrg: Map<string, number>;
  readonly charges: ChargeBook;
  readonly statementsByOrg: Map<string, TransactionMirror[]>;
  readonly telegramBindings: Map<string, string>;
  readonly webhookSecret: string;
}

const normalizeAsaasBaseUrl = (
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  if (value.trim().length === 0) return undefined;
  return value.trim();
};

export interface BaasProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

type AppRuntimeEnv = LlmEnv & {
  readonly ASAAS_WEBHOOK_TOKEN?: string;
};

export function createAppContext(
  webhookSecret: string,
  providerConfig: BaasProviderConfig = {},
): AppContext {
  const auditChain: AuditEvent[] = [];
  const provider =
    providerConfig.apiKey && providerConfig.baseUrl
      ? new AsaasBaasProvider(providerConfig.apiKey, providerConfig.baseUrl)
      : new SandboxBaasProvider();
  return {
    provider,
    ledger: new MovementLedger(),
    gate: new OnboardingGate(),
    consents: new ConsentLedger(),
    tickets: new SupportTicketQueue(),
    auditChain,
    rulesByOrg: new Map(),
    balancesByOrg: new Map(),
    charges: new ChargeBook(),
    statementsByOrg: new Map(),
    telegramBindings: new Map(),
    webhookSecret,
  };
}

export function resolveBaasProviderFromEnv(): BaasProviderConfig {
  const providerConfig: BaasProviderConfig = {
    apiKey: process.env.ASAAS_API_KEY,
    baseUrl: normalizeAsaasBaseUrl(process.env.ASAAS_BASE_URL),
  };
  if (!providerConfig.apiKey) {
    providerConfig.apiKey = undefined;
  }
  return providerConfig;
}

export function auditSinkFor(
  context: AppContext,
): (input: AuditEventInput) => void {
  return (input: AuditEventInput): void => {
    context.auditChain.push(appendAuditEvent(context.auditChain, input));
  };
}

export async function registerAllRoutes(
  app: FastifyInstance,
  context: AppContext,
  env: AppRuntimeEnv = {},
): Promise<void> {
  const auditSink = auditSinkFor(context);
  // PORQUÊ: com chave free no ambiente, o LLM real assume. Sem chave, o stub
  // determinístico responde. O schema valida os dois do mesmo jeito.
  const liveAssistant = assistantFromEnv(env, fetchJsonHttpClient());
  const answerDraft = liveAssistant
    ? (redactedText: string) => liveAssistant.draftAnswer(redactedText)
    : async (redactedText: string) =>
        parseAssistantOutput(draftFromKeywords(redactedText));
  await registerWhatsappWebhook(app, {
    tickets: context.tickets,
    auditSink,
    answerDraft,
  });
  await registerBaasWebhook(app, {
    ledger: context.ledger,
    webhookSecret: context.webhookSecret,
  });
  await registerAsaasWebhook(app, {
    ledger: context.ledger,
    webhookToken: env.ASAAS_WEBHOOK_TOKEN ?? "",
  });
  await registerPixOutApi(app, {
    provider: context.provider,
    ledger: context.ledger,
    gate: context.gate,
    auditSink,
  });
  await registerCashApi(app, {
    rulesByOrg: context.rulesByOrg,
    balancesByOrg: context.balancesByOrg,
  });
  await registerTicketsApi(app, { queue: context.tickets });
  await registerChargesApi(app, { charges: context.charges, auditSink });
  await registerReadApi(app, {
    ledger: context.ledger,
    charges: context.charges,
    rulesByOrg: context.rulesByOrg,
    balancesByOrg: context.balancesByOrg,
    auditChain: context.auditChain,
  });
  await registerReceiptsApi(app, {
    statementsByOrg: context.statementsByOrg,
    tickets: context.tickets,
    auditSink,
  });
  await registerTelegramWebhook(app, {
    tickets: context.tickets,
    auditSink,
    answerDraft,
    orgBindings: context.telegramBindings,
  });
}

function draftFromKeywords(redactedText: string): unknown {
  // PORQUÊ: stub determinístico até o LLM real entrar. Palavras decidem o intent,
  // o schema decide se vira resposta ou ticket. Nenhum valor sai daqui.
  const lower = redactedText.toLowerCase();
  if (
    lower.includes("contest") ||
    lower.includes("discordo") ||
    lower.includes("cobrança indevida")
  ) {
    return {
      intent: "CONTESTACAO",
      confidence: 0.8,
      answerDraft: "Vou abrir um protocolo para o time verificar.",
      referencedTransactionIds: [],
    };
  }
  if (lower.includes("limite")) {
    return {
      intent: "LIMITE_PEDIDO",
      confidence: 0.8,
      answerDraft: "Pedido de limite registrado para análise humana.",
      referencedTransactionIds: [],
    };
  }
  if (lower.includes("saldo")) {
    return {
      intent: "SALDO",
      confidence: 0.9,
      answerDraft: "Consultando seu saldo no ledger.",
      referencedTransactionIds: [],
    };
  }
  return {
    intent: "DESCONHECIDO",
    confidence: 0.4,
    answerDraft: "Não entendi. Um atendente pode ajudar?",
    referencedTransactionIds: [],
  };
}
