// PORQUÊ: estado do Sites espelha BankState do runtime para manter o cockpit idêntico.
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface BankApproval {
  id: string;
  kind: string;
  label: string;
  title: string;
  detail: string;
  amountInCents?: number;
  recipientId?: string;
  creatorId: string;
  createdAt: string;
  status: ApprovalStatus;
  version: number;
}

export interface SandboxMovement {
  id: string;
  direction: "IN" | "OUT";
  description: string;
  amountInCents: number;
  occurredAt: string;
  status: "CONFIRMED" | "SANDBOX_CONFIRMED";
}

export interface SandboxCharge {
  id: string;
  customerName: string;
  amountInCents: number;
  dueDate: string;
  createdAt: string;
  status: "OPEN" | "PAID" | "CANCELED";
  version: number;
}

export interface SandboxRecipient {
  id: string;
  name: string;
  keyType: "EMAIL" | "EVP";
  keyMasked: string;
  verified: boolean;
}

export interface MutationReceipt {
  scope: string;
  response: unknown;
  createdAt: string;
}

export interface BankState {
  orgId: string;
  displayName: string;
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

export interface AuditDraft {
  agent: string;
  action: string;
  resourceId: string;
  payload: Record<string, unknown>;
}

export interface CommandResult {
  payload: Record<string, unknown>;
  events: AuditDraft[];
}

export interface BankRow {
  id: string;
  org_id: string;
  actor_id: string;
  token_hash: string | null;
  csrf_token: string;
  expires_at: number;
  revision: number;
  state_json: string;
  audit_head: string;
  audit_count: number;
}

export interface SqlResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch<T = Record<string, unknown>>(
    statements: SqlStatement[],
  ): Promise<SqlResult<T>[]>;
}

export interface Environment {
  DB: SqlDatabase;
  ASSETS: { fetch(request: Request): Promise<Response> };
  PUBLIC_ORIGIN?: string;
}
