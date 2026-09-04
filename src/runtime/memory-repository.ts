import { randomUUID } from "node:crypto";

import { appendAuditChain } from "./audit-chain.js";
import type {
  AuditDraft,
  AuditRecord,
  BankState,
  SessionIdentity,
} from "./contracts.js";
import { createDemoState } from "./demo-state.js";
import type {
  BankRepository,
  CreateSessionInput,
  StateMutator,
} from "./repository.js";
import { RuntimeError } from "./runtime-error.js";

interface MemorySession extends SessionIdentity {
  readonly tokenHash: string;
  csrfHash: string;
}

export class MemoryBankRepository implements BankRepository {
  private readonly states = new Map<string, BankState>();
  private readonly sessions = new Map<string, MemorySession>();
  private readonly audits = new Map<string, AuditRecord[]>();

  public async initialize(): Promise<void> {}

  public async health(): Promise<boolean> {
    return true;
  }

  public async createSession(
    input: CreateSessionInput,
  ): Promise<SessionIdentity> {
    const session = createMemorySession(input);
    const state = createDemoState(session.orgId, input.now);
    this.sessions.set(input.tokenHash, session);
    this.states.set(session.orgId, state);
    this.audits.set(
      session.orgId,
      appendAuditChain([], initialAudit(input.now)),
    );
    return toIdentity(session);
  }

  public async findSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionIdentity | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= now.getTime()) return null;
    return toIdentity(session);
  }

  public async rotateCsrf(sessionId: string, csrfHash: string): Promise<void> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (!session)
      throw new RuntimeError(
        401,
        "SESSION_NOT_FOUND",
        "A sessão informada não existe.",
      );
    session.csrfHash = csrfHash;
  }

  public async verifyCsrf(
    sessionId: string,
    csrfHash: string,
    now: Date,
  ): Promise<boolean> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    return Boolean(
      session &&
      session.csrfHash === csrfHash &&
      Date.parse(session.expiresAt) > now.getTime(),
    );
  }

  public async readState(orgId: string): Promise<BankState> {
    return cloneState(this.requireState(orgId));
  }

  public async mutateState<T>(
    orgId: string,
    mutator: StateMutator<T>,
    now: Date,
  ): Promise<T> {
    const state = cloneState(this.requireState(orgId));
    const mutation = mutator(state);
    if (mutation.audits.length === 0) return mutation.value;
    state.version += 1;
    state.updatedAt = now.toISOString();
    this.states.set(orgId, state);
    this.appendAudits(orgId, mutation.audits);
    return mutation.value;
  }

  public async listAudit(orgId: string): Promise<AuditRecord[]> {
    return [...(this.audits.get(orgId) ?? [])];
  }

  public async close(): Promise<void> {}

  private requireState(orgId: string): BankState {
    const state = this.states.get(orgId);
    if (!state)
      throw new RuntimeError(
        404,
        "ORGANIZATION_NOT_FOUND",
        "A organização da sessão não existe.",
      );
    return state;
  }

  private appendAudits(orgId: string, drafts: readonly AuditDraft[]): void {
    const current = this.audits.get(orgId) ?? [];
    this.audits.set(orgId, appendAuditChain(current, drafts));
  }
}

function createMemorySession(input: CreateSessionInput): MemorySession {
  const sessionId = randomUUID();
  return {
    sessionId,
    orgId: randomUUID(),
    displayName: "Novaes Comércio Ltda.",
    tokenHash: input.tokenHash,
    csrfHash: input.csrfHash,
    expiresAt: input.expiresAt.toISOString(),
  };
}

function toIdentity(session: MemorySession): SessionIdentity {
  return {
    sessionId: session.sessionId,
    orgId: session.orgId,
    displayName: session.displayName,
    expiresAt: session.expiresAt,
  };
}

function cloneState(state: BankState): BankState {
  return structuredClone(state);
}

function initialAudit(now: Date): AuditDraft[] {
  return [
    {
      agent: "Sistema",
      action: "SANDBOX_CRIADO",
      objectId: "organization",
      channel: "SYSTEM",
      status: "CONCLUÍDO",
      detail:
        "Ambiente isolado criado com dados exclusivamente demonstrativos.",
      recordedAt: now.toISOString(),
    },
  ];
}
