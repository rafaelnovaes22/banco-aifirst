import type {
  AuditRecord,
  BankState,
  SessionIdentity,
  StateMutation,
} from "./contracts.js";

export type StateMutator<T> = (state: BankState) => StateMutation<T>;

export interface CreateSessionInput {
  readonly tokenHash: string;
  readonly csrfHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export interface BankRepository {
  initialize(): Promise<void>;
  health(): Promise<boolean>;
  createSession(input: CreateSessionInput): Promise<SessionIdentity>;
  findSession(tokenHash: string, now: Date): Promise<SessionIdentity | null>;
  rotateCsrf(sessionId: string, csrfHash: string): Promise<void>;
  verifyCsrf(sessionId: string, csrfHash: string, now: Date): Promise<boolean>;
  readState(orgId: string): Promise<BankState>;
  mutateState<T>(
    orgId: string,
    mutator: StateMutator<T>,
    now: Date,
  ): Promise<T>;
  listAudit(orgId: string): Promise<AuditRecord[]>;
  close(): Promise<void>;
}
