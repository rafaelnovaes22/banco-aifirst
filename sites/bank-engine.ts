import type {
  AuditDraft,
  BankApproval,
  BankState,
  CommandResult,
  MutationReceipt,
  SandboxMovement,
} from "./types.ts";
import { buildPlan, classifyCommand } from "./command-policy.ts";
import type { CommandIntent } from "./command-policy.ts";
import { evaluateApprovalPayment } from "./policy.ts";
import { HttpError } from "./validation.ts";

// PORQUÊ: motor do Sites espelha command-engine do Node e adiciona criador mais
// alçada na decisão. Idempotência e recibos evitam débito duplo em retry.
const RECEIPT_LIMIT = 256;

export interface ApprovalDecision {
  approval: BankApproval;
  movement: SandboxMovement | null;
  blocked?: boolean;
  detail?: string;
}

export function runBankCommand(
  state: BankState,
  actorId: string,
  rawCommand: unknown,
  idempotencyKey: string,
  now: Date,
): { value: CommandResult["payload"]; audits: AuditDraft[] } {
  const receiptKey = `command:${idempotencyKey}`;
  const existing = state.receipts[receiptKey];
  if (existing)
    return { value: existing.response as CommandResult["payload"], audits: [] };
  const result = buildCommandResult(state, actorId, rawCommand, now);
  storeReceipt(state, receiptKey, result, now);
  return { value: result, audits: [commandAudit(result)] };
}

function buildCommandResult(
  state: BankState,
  actorId: string,
  rawCommand: unknown,
  now: Date,
): CommandResult["payload"] {
  const classification = classifyCommand(rawCommand);
  if (!classification.ok)
    return blockedResult(String(rawCommand ?? ""), classification.reason);
  const plan = buildPlan(classification.intent, classification.action);
  const approval = plan.approvalRequired
    ? createApproval(
        state,
        actorId,
        classification.intent,
        classification.command,
        now,
      )
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

function blockedResult(
  command: string,
  reason: string,
): CommandResult["payload"] {
  const messages: Record<string, string> = {
    empty: "Escreva um objetivo financeiro para o agente analisar.",
    too_long: "O comando ultrapassou 240 caracteres. Resuma o objetivo.",
    unsafe:
      "O comando foi bloqueado pelas regras de segurança e registrado na auditoria.",
  };
  return {
    command: command.slice(0, 240),
    agent: "Guardião de Segurança",
    message: messages[reason] ?? messages["unsafe"] ?? "Comando bloqueado.",
    status: "BLOCKED",
    approval: null,
  };
}

function createApproval(
  state: BankState,
  actorId: string,
  intent: CommandIntent,
  command: string,
  now: Date,
): BankApproval {
  const details = APPROVAL_DETAILS[intent];
  const amountInCents = ["payment", "cash", "tax"].includes(intent)
    ? (parseAmountInCents(command) ?? details.defaultAmountInCents)
    : undefined;
  return {
    id: crypto.randomUUID(),
    kind: intent,
    label: details.label,
    title: titleFor(details.title, amountInCents),
    detail: intent === "payment" ? recipientDetail(state) : details.detail,
    amountInCents,
    recipientId: intent === "payment" ? state.recipients[0]?.id : undefined,
    creatorId: actorId,
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

export function parseAmountInCents(command: string): number | undefined {
  const match =
    command.match(/r\$\s*([^\s]+)/i) ?? command.match(/([^\s]+)\s+reais/i);
  if (!match?.[1] && !/r\$|\breais\b/i.test(command)) return undefined;
  const token = match?.[1] ?? "";
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(token)) {
    throw new HttpError(
      422,
      `Valor ${token || "ausente"} inválido. Use reais, por exemplo R$ 1.250,00.`,
    );
  }
  const amount = Number(token.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new HttpError(
      422,
      `Valor ${token} inválido. Use de R$ 0,01 a R$ 1.000.000,00 no sandbox.`,
    );
  }
  return Math.round(amount * 100);
}

function recipientDetail(state: BankState): string {
  const recipient = state.recipients[0];
  if (!recipient) {
    throw new HttpError(422, "Nenhum favorecido demonstrativo disponível.");
  }
  return `Favorecido demonstrativo: ${recipient.name} (${recipient.keyMasked}). Confira antes de aprovar. Nenhum dinheiro real será movimentado.`;
}

function titleFor(template: string, amountInCents: number | undefined): string {
  if (amountInCents === undefined) return template;
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountInCents / 100);
  return template.replace("{amount}", formatted);
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
  const overflow = ordered.slice(
    0,
    Math.max(0, ordered.length - RECEIPT_LIMIT),
  );
  for (const [key] of overflow) delete state.receipts[key];
}

function createReceipt(
  scope: string,
  response: unknown,
  now: Date,
): MutationReceipt {
  return { scope, response, createdAt: now.toISOString() };
}

function commandAudit(result: CommandResult["payload"]): AuditDraft {
  const record = result as { status: string; approval: unknown; agent: string };
  return {
    agent: record.agent,
    action: record.approval ? "APROVAÇÃO_CRIADA" : "COMANDO_ANALISADO",
    resourceId: (record.approval as { id?: string } | null)?.id ?? "command",
    payload: { status: record.status },
  };
}

export function decideBankApproval(
  state: BankState,
  actorId: string,
  approvalId: string,
  decision: "APPROVE" | "REJECT",
  expectedVersion: number,
  idempotencyKey: string,
  now: Date,
): { value: ApprovalDecision; audits: AuditDraft[] } {
  const receiptKey = `approval:${approvalId}:${idempotencyKey}`;
  const existing = state.receipts[receiptKey];
  if (existing)
    return { value: existing.response as ApprovalDecision, audits: [] };
  const approval = requirePendingApproval(state, approvalId, expectedVersion);
  if (decision === "REJECT") {
    approval.status = "REJECTED";
    approval.version += 1;
    const value: ApprovalDecision = {
      approval: { ...approval },
      movement: null,
    };
    storeReceipt(state, receiptKey, value, now);
    return { value, audits: [approvalAudit(approval, false)] };
  }
  const movement = applyApproval(state, actorId, approval, now);
  if (!movement.allowed) {
    const value: ApprovalDecision = {
      approval: { ...approval },
      movement: null,
      blocked: true,
      detail: movement.reasons.join("; "),
    };
    storeReceipt(state, receiptKey, value, now);
    return { value, audits: [blockedAudit(approval, movement.reasons)] };
  }
  const value: ApprovalDecision = {
    approval: { ...approval },
    movement: movement.record,
  };
  storeReceipt(state, receiptKey, value, now);
  return { value, audits: [approvalAudit(approval, true)] };
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
    throw new HttpError(409, "A aprovação não existe nesta sessão.");
  if (approval.version !== expectedVersion) {
    throw new HttpError(409, "A aprovação mudou. Atualize a tela.");
  }
  if (approval.status !== "PENDING") {
    throw new HttpError(409, "A aprovação já recebeu uma decisão.");
  }
  return approval;
}

function applyApproval(
  state: BankState,
  actorId: string,
  approval: BankApproval,
  now: Date,
): { allowed: boolean; reasons: string[]; record: SandboxMovement | null } {
  if (
    !["payment", "cash", "tax"].includes(approval.kind) ||
    !approval.amountInCents
  ) {
    approval.status = "APPROVED";
    approval.version += 1;
    return { allowed: true, reasons: [], record: null };
  }
  if (approval.kind === "payment") {
    const recipient = state.recipients.find(
      (item) => item.id === approval.recipientId,
    );
    const verdict = evaluateApprovalPayment({
      amountInCents: approval.amountInCents,
      recipientVerified: recipient?.verified ?? false,
      creatorId: approval.creatorId,
      approverId: actorId,
      balanceInCents: state.balanceInCents,
    });
    if (!verdict.allowed)
      return { allowed: false, reasons: verdict.reasons, record: null };
  } else if (approval.amountInCents > state.balanceInCents) {
    return {
      allowed: false,
      reasons: ["O saldo demonstrativo não cobre a operação."],
      record: null,
    };
  }
  const record: SandboxMovement = {
    id: crypto.randomUUID(),
    direction: "OUT",
    description: `${approval.label}, ambiente sandbox`,
    amountInCents: approval.amountInCents,
    occurredAt: now.toISOString(),
    status: "SANDBOX_CONFIRMED",
  };
  state.balanceInCents -= approval.amountInCents;
  state.expensesInCents += approval.amountInCents;
  state.movements.unshift(record);
  approval.status = "APPROVED";
  approval.version += 1;
  return { allowed: true, reasons: [], record };
}

function approvalAudit(approval: BankApproval, approved: boolean): AuditDraft {
  return {
    agent: "Responsável humano",
    action: approved ? "APROVAÇÃO_CONFIRMADA" : "APROVAÇÃO_RECUSADA",
    resourceId: approval.id,
    payload: {},
  };
}

function blockedAudit(approval: BankApproval, reasons: string[]): AuditDraft {
  return {
    agent: "Política de alçada",
    action: "APROVAÇÃO_BLOQUEADA",
    resourceId: approval.id,
    payload: { reasons },
  };
}
