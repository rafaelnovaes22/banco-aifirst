export type CommandIntent =
  "cash" | "fraud" | "tax" | "payment" | "audit" | "general";

export type CommandAction =
  "read" | "simulate" | "prepare" | "execute" | "block" | "change_policy";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type AuditStatus =
  "CONCLUÍDO" | "AGUARDANDO" | "BLOQUEADO" | "APROVADO" | "RECUSADO";

export interface SandboxRecipient {
  readonly id: string;
  readonly name: string;
  readonly keyType: "EMAIL" | "EVP";
  readonly keyMasked: string;
}

export interface BankApproval {
  readonly id: string;
  readonly kind: CommandIntent;
  readonly label: string;
  readonly title: string;
  readonly detail: string;
  readonly amountInCents?: number;
  readonly recipientId?: string;
  readonly createdAt: string;
  status: ApprovalStatus;
  version: number;
}

export interface SandboxMovement {
  readonly id: string;
  readonly direction: "IN" | "OUT";
  readonly description: string;
  readonly amountInCents: number;
  readonly occurredAt: string;
  readonly status: "CONFIRMED" | "SANDBOX_CONFIRMED";
}

export interface SandboxCharge {
  readonly id: string;
  readonly customerName: string;
  readonly amountInCents: number;
  readonly dueDate: string;
  readonly createdAt: string;
  status: "OPEN" | "PAID" | "CANCELED";
  version: number;
}

export interface MutationReceipt {
  readonly scope: string;
  readonly response: unknown;
  readonly createdAt: string;
}

export interface BankState {
  readonly orgId: string;
  readonly displayName: string;
  balanceInCents: number;
  forecastInCents: number;
  receivablesInCents: number;
  expensesInCents: number;
  riskScore: number;
  version: number;
  updatedAt: string;
  approvals: BankApproval[];
  movements: SandboxMovement[];
  charges: SandboxCharge[];
  recipients: SandboxRecipient[];
  receipts: Record<string, MutationReceipt>;
}

export interface SessionIdentity {
  readonly sessionId: string;
  readonly orgId: string;
  readonly displayName: string;
  readonly expiresAt: string;
}

export interface AuditDraft {
  readonly agent: string;
  readonly action: string;
  readonly objectId: string;
  readonly channel: "PANEL" | "SYSTEM";
  readonly status: AuditStatus;
  readonly detail: string;
  readonly recordedAt: string;
}

export interface AuditRecord extends AuditDraft {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export interface StateMutation<T> {
  readonly value: T;
  readonly audits: readonly AuditDraft[];
}

export interface CommandPlan {
  readonly agent: string;
  readonly approvalRequired: boolean;
  readonly message: string;
}

export interface CommandResult {
  readonly command: string;
  readonly agent: string;
  readonly message: string;
  readonly status: "COMPLETED" | "APPROVAL_REQUIRED" | "BLOCKED";
  readonly approval: BankApproval | null;
}

export interface CockpitView {
  readonly company: { readonly name: string; readonly sessionLabel: string };
  readonly money: {
    readonly balanceInCents: number;
    readonly forecastInCents: number;
    readonly receivablesInCents: number;
    readonly expensesInCents: number;
  };
  readonly risk: { readonly score: number; readonly label: string };
  readonly approvals: readonly BankApproval[];
  readonly movements: readonly SandboxMovement[];
  readonly charges: readonly SandboxCharge[];
  readonly recipients: readonly SandboxRecipient[];
  readonly stateVersion: number;
  readonly updatedAt: string;
}
