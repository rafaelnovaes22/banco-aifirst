import { randomUUID } from "node:crypto";

import type {
  AuditDraft,
  BankApproval,
  BankState,
  CommandIntent,
  CommandResult,
  MutationReceipt,
  SandboxMovement,
  StateMutation,
} from "./contracts.js";
import { buildPlan, classifyCommand } from "./command-policy.js";
import { conflict, unprocessable } from "./runtime-error.js";

const RECEIPT_LIMIT = 256;

export interface ApprovalDecisionResult {
  readonly approval: BankApproval;
  readonly movement: SandboxMovement | null;
}

export function runCommand(
  state: BankState,
  rawCommand: unknown,
  idempotencyKey: string,
  now: Date,
): StateMutation<CommandResult> {
  const receiptKey = `command:${idempotencyKey}`;
  const existing = state.receipts[receiptKey];
  if (existing)
    return { value: existing.response as CommandResult, audits: [] };
  const result = buildCommandResult(state, rawCommand, now);
  storeReceipt(state, receiptKey, result, now);
  return { value: result, audits: [commandAudit(result, now)] };
}

function buildCommandResult(
  state: BankState,
  rawCommand: unknown,
  now: Date,
): CommandResult {
  const classification = classifyCommand(rawCommand);
  if (!classification.ok)
    return blockedResult(String(rawCommand ?? ""), classification.reason);
  const plan = buildPlan(classification.intent, classification.action);
  const approval = plan.approvalRequired
    ? createApproval(state, classification.intent, classification.command, now)
    : null;
  if (approval) state.approvals.unshift(approval);
  return {
    command: classification.command,
    agent: plan.agent,
    message: plan.message,
    status: approval ? "APPROVAL_REQUIRED" : "COMPLETED",
    approval,
  };
}

function blockedResult(command: string, reason: string): CommandResult {
  const messages: Record<string, string> = {
    empty: "Escreva um objetivo financeiro para o agente analisar.",
    too_long: "O comando ultrapassou 240 caracteres. Resuma o objetivo.",
    unsafe:
      "O comando foi bloqueado pelas regras de segurança e registrado na auditoria.",
  };
  return {
    command: command.slice(0, 240),
    agent: "Guardião de Segurança",
    message: messages[reason] ?? messages.unsafe ?? "Comando bloqueado.",
    status: "BLOCKED",
    approval: null,
  };
}

function createApproval(
  state: BankState,
  intent: CommandIntent,
  command: string,
  now: Date,
): BankApproval {
  const details = APPROVAL_DETAILS[intent];
  const amountInCents = ["payment", "cash", "tax"].includes(intent)
    ? (parseAmountInCents(command) ?? details.defaultAmountInCents)
    : undefined;
  const recipientId =
    intent === "payment" ? state.recipients[0]?.id : undefined;
  return {
    id: randomUUID(),
    kind: intent,
    label: details.label,
    title: titleFor(details.title, amountInCents),
    detail: intent === "payment" ? recipientDetail(state) : details.detail,
    amountInCents,
    recipientId,
    createdAt: now.toISOString(),
    status: "PENDING",
    version: 1,
  };
}

const APPROVAL_DETAILS: Record<
  CommandIntent,
  {
    label: string;
    title: string;
    detail: string;
    defaultAmountInCents?: number;
  }
> = {
  payment: {
    label: "PIX PREPARADO",
    title: "Transferir {amount} no sandbox",
    detail:
      "Favorecido permitido e limite validados. Nenhum dinheiro real será movimentado.",
    defaultAmountInCents: 1_842_000,
  },
  cash: {
    label: "RESERVA SUGERIDA",
    title: "Separar {amount} para reserva",
    detail: "Mantém 60 dias de operação sem depender de novas entradas.",
    defaultAmountInCents: 4_200_000,
  },
  tax: {
    label: "TRIBUTO PREPARADO",
    title: "Pagar {amount} em tributos no sandbox",
    detail: "Guia demonstrativa validada. A saída exige aprovação humana.",
    defaultAmountInCents: 2_468_000,
  },
  fraud: {
    label: "BLOQUEIO PREPARADO",
    title: "Bloquear duas transações suspeitas",
    detail: "A medida preventiva só entra em vigor após aprovação humana.",
  },
  audit: {
    label: "EXPORTAÇÃO PREPARADA",
    title: "Exportar evidências de auditoria",
    detail: "A trilha será exportada sem dados sensíveis.",
  },
  general: {
    label: "POLÍTICA PREPARADA",
    title: "Alterar política operacional",
    detail: "Mudanças de regra exigem aprovação do responsável.",
  },
};

function parseAmountInCents(command: string): number | undefined {
  const match =
    command.match(/r\$\s*([^\s]+)/i) ?? command.match(/([^\s]+)\s+reais/i);
  if (!match?.[1] && !/r\$|\breais\b/i.test(command)) return undefined;
  const token = match?.[1] ?? "";
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(token))
    throw unprocessable(
      "INVALID_AMOUNT",
      `Valor ${token || "ausente"} inválido. Use reais, por exemplo R$ 1.250,00.`,
    );
  const amount = Number(token.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000)
    throw unprocessable(
      "INVALID_AMOUNT",
      `Valor ${token} inválido. Use de R$ 0,01 a R$ 1.000.000,00 no sandbox.`,
    );
  return Math.round(amount * 100);
}

function recipientDetail(state: BankState): string {
  const recipient = state.recipients[0];
  if (!recipient)
    throw unprocessable(
      "NO_SANDBOX_RECIPIENT",
      "Nenhum favorecido demonstrativo disponível.",
    );
  return `Favorecido demonstrativo: ${recipient.name} (${recipient.keyMasked}). Confira antes de aprovar. Nenhum dinheiro real será movimentado.`;
}

function titleFor(template: string, amountInCents: number | undefined): string {
  if (amountInCents === undefined) return template;
  return template.replace("{amount}", formatBrl(amountInCents));
}

function formatBrl(amountInCents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountInCents / 100);
}

function createReceipt(
  scope: string,
  response: unknown,
  now: Date,
): MutationReceipt {
  return { scope, response, createdAt: now.toISOString() };
}

function storeReceipt(
  state: BankState,
  scope: string,
  response: unknown,
  now: Date,
): void {
  state.receipts[scope] = createReceipt(scope, response, now);
  const ordered = Object.entries(state.receipts).sort((left, right) =>
    left[1].createdAt.localeCompare(right[1].createdAt),
  );
  for (const [key] of ordered.slice(
    0,
    Math.max(0, ordered.length - RECEIPT_LIMIT),
  )) {
    delete state.receipts[key];
  }
}

function commandAudit(result: CommandResult, now: Date): AuditDraft {
  const status =
    result.status === "BLOCKED"
      ? "BLOQUEADO"
      : result.approval
        ? "AGUARDANDO"
        : "CONCLUÍDO";
  return {
    agent: result.agent,
    action: result.approval ? "APROVAÇÃO_CRIADA" : "COMANDO_ANALISADO",
    objectId: result.approval?.id ?? "command",
    channel: "PANEL",
    status,
    detail: result.message,
    recordedAt: now.toISOString(),
  };
}

export function decideApproval(
  state: BankState,
  approvalId: string,
  decision: "APPROVE" | "REJECT",
  expectedVersion: number,
  idempotencyKey: string,
  now: Date,
): StateMutation<ApprovalDecisionResult> {
  const receiptKey = `approval:${approvalId}:${idempotencyKey}`;
  const existing = state.receipts[receiptKey];
  if (existing)
    return { value: existing.response as ApprovalDecisionResult, audits: [] };
  const approval = requirePendingApproval(state, approvalId, expectedVersion);
  const movement =
    decision === "APPROVE" ? applyApprovedAction(state, approval, now) : null;
  approval.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  approval.version += 1;
  const value = { approval: structuredClone(approval), movement };
  storeReceipt(state, receiptKey, value, now);
  return { value, audits: [approvalAudit(approval, decision, now)] };
}

function requirePendingApproval(
  state: BankState,
  approvalId: string,
  expectedVersion: number,
): BankApproval {
  const approval = state.approvals.find(
    (candidate) => candidate.id === approvalId,
  );
  if (!approval)
    throw conflict(
      "APPROVAL_NOT_FOUND",
      "A aprovação não existe nesta sessão.",
    );
  if (approval.version !== expectedVersion)
    throw conflict("VERSION_CONFLICT", "A aprovação mudou. Atualize a tela.");
  if (approval.status !== "PENDING")
    throw conflict("APPROVAL_DECIDED", "A aprovação já recebeu uma decisão.");
  return approval;
}

function applyApprovedAction(
  state: BankState,
  approval: BankApproval,
  now: Date,
): SandboxMovement | null {
  if (
    !["payment", "cash", "tax"].includes(approval.kind) ||
    !approval.amountInCents
  )
    return null;
  if (approval.amountInCents > state.balanceInCents) {
    throw unprocessable(
      "INSUFFICIENT_SANDBOX_BALANCE",
      "O saldo demonstrativo não cobre a operação.",
    );
  }
  const movement = createMovement(approval, now);
  state.balanceInCents -= approval.amountInCents;
  state.expensesInCents += approval.amountInCents;
  state.movements.unshift(movement);
  return movement;
}

function createMovement(approval: BankApproval, now: Date): SandboxMovement {
  return {
    id: randomUUID(),
    direction: "OUT",
    description: `${approval.label}, ambiente sandbox`,
    amountInCents: approval.amountInCents ?? 0,
    occurredAt: now.toISOString(),
    status: "SANDBOX_CONFIRMED",
  };
}

function approvalAudit(
  approval: BankApproval,
  decision: "APPROVE" | "REJECT",
  now: Date,
): AuditDraft {
  const approved = decision === "APPROVE";
  return {
    agent: "Responsável humano",
    action: approved ? "APROVAÇÃO_CONFIRMADA" : "APROVAÇÃO_RECUSADA",
    objectId: approval.id,
    channel: "PANEL",
    status: approved ? "APROVADO" : "RECUSADO",
    detail: approved
      ? `${approval.title}. Execução restrita ao sandbox.`
      : `${approval.title}. Nenhuma ação executada.`,
    recordedAt: now.toISOString(),
  };
}
