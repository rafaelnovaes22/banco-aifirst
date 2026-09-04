import { randomUUID } from "node:crypto";

import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";

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

export type PostgresPoolFactory = (config: PoolConfig) => Pool;

export interface PostgresRepositoryOptions {
  readonly databaseUrl?: string;
  readonly poolFactory?: PostgresPoolFactory;
}

interface OrganizationRow extends QueryResultRow {
  readonly state: unknown;
}

interface SessionRow extends QueryResultRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly display_name: string;
  readonly expires_at: Date | string;
}

interface AuditRow extends QueryResultRow {
  readonly seq: number | string;
  readonly agent: string;
  readonly action: string;
  readonly object_id: string;
  readonly channel: AuditRecord["channel"];
  readonly status: AuditRecord["status"];
  readonly detail: string;
  readonly prev_hash: string;
  readonly hash: string;
  readonly recorded_at: Date | string;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    org_id UUID NOT NULL REFERENCES organizations(id),
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_records (
    org_id UUID NOT NULL REFERENCES organizations(id),
    seq BIGINT NOT NULL,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    object_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    prev_hash CHAR(64) NOT NULL,
    hash CHAR(64) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (org_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON sessions (expires_at)`,
  `CREATE OR REPLACE FUNCTION reject_audit_records_mutation()
    RETURNS trigger AS $audit_guard$
    BEGIN
      RAISE EXCEPTION 'audit_records is append-only';
    END;
    $audit_guard$ LANGUAGE plpgsql`,
  `DO $audit_trigger$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'audit_records_append_only'
          AND tgrelid = 'audit_records'::regclass
      ) THEN
        CREATE TRIGGER audit_records_append_only
        BEFORE UPDATE OR DELETE ON audit_records
        FOR EACH ROW EXECUTE FUNCTION reject_audit_records_mutation();
      END IF;
    END;
    $audit_trigger$`,
] as const;

const SELECT_SESSION = `SELECT
  s.id AS session_id,
  s.org_id,
  o.state ->> 'displayName' AS display_name,
  s.expires_at
FROM sessions s
JOIN organizations o ON o.id = s.org_id
WHERE s.token_hash = $1 AND s.expires_at > $2
LIMIT 1`;

const SELECT_AUDIT = `SELECT
  seq, agent, action, object_id, channel, status,
  detail, prev_hash, hash, recorded_at
FROM audit_records
WHERE org_id = $1
ORDER BY seq ASC`;

const SELECT_LAST_AUDIT_FOR_UPDATE = `SELECT
  seq, agent, action, object_id, channel, status,
  detail, prev_hash, hash, recorded_at
FROM audit_records
WHERE org_id = $1
ORDER BY seq DESC
LIMIT 1
FOR UPDATE`;

const INSERT_AUDIT = `INSERT INTO audit_records (
  org_id, seq, agent, action, object_id, channel,
  status, detail, prev_hash, hash, recorded_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

const defaultPoolFactory: PostgresPoolFactory = (config) => new Pool(config);

export class PostgresBankRepository implements BankRepository {
  private readonly pool: Pool;

  public constructor(options: PostgresRepositoryOptions = {}) {
    const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      throw new Error(
        "DATABASE_URL ausente: o repositório PostgreSQL exige uma conexão explícita.",
      );
    }
    this.pool = (options.poolFactory ?? defaultPoolFactory)({
      connectionString: databaseUrl,
    });
  }

  public async initialize(): Promise<void> {
    await this.withTransaction(async (client) => {
      for (const statement of SCHEMA_STATEMENTS) await client.query(statement);
    });
  }

  public async health(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  public async createSession(
    input: CreateSessionInput,
  ): Promise<SessionIdentity> {
    const sessionId = randomUUID();
    const orgId = randomUUID();
    const state = createDemoState(orgId, input.now);
    const audits = appendAuditChain([], initialAudit(input.now));
    await this.withTransaction(async (client) => {
      await insertOrganization(client, state, input.now);
      await insertSession(client, sessionId, orgId, input);
      await insertAudits(client, orgId, audits);
    });
    return identityFromState(sessionId, state, input.expiresAt);
  }

  public async findSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionIdentity | null> {
    const result = await this.pool.query<SessionRow>(SELECT_SESSION, [
      tokenHash,
      now,
    ]);
    const row = result.rows[0];
    return row ? identityFromRow(row) : null;
  }

  public async rotateCsrf(sessionId: string, csrfHash: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE sessions SET csrf_hash = $2 WHERE id = $1 RETURNING id`,
      [sessionId, csrfHash],
    );
    if (result.rowCount === 0) {
      throw new RuntimeError(
        401,
        "SESSION_NOT_FOUND",
        "A sessão informada não existe.",
      );
    }
  }

  public async verifyCsrf(
    sessionId: string,
    csrfHash: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM sessions
       WHERE id = $1 AND csrf_hash = $2 AND expires_at > $3`,
      [sessionId, csrfHash, now],
    );
    return result.rowCount === 1;
  }

  public async readState(orgId: string): Promise<BankState> {
    const result = await this.pool.query<OrganizationRow>(
      "SELECT state FROM organizations WHERE id = $1",
      [orgId],
    );
    return stateFromRow(result.rows[0], orgId);
  }

  public async mutateState<T>(
    orgId: string,
    mutator: StateMutator<T>,
    now: Date,
  ): Promise<T> {
    return this.withTransaction(async (client) => {
      const state = await lockState(client, orgId);
      const mutation = mutator(state);
      if (mutation.audits.length === 0) return mutation.value;
      state.version += 1;
      state.updatedAt = now.toISOString();
      const previous = await lockLastAudit(client, orgId);
      const audits = chainAfter(previous, mutation.audits);
      await updateOrganization(client, orgId, state, now);
      await insertAudits(client, orgId, audits);
      return mutation.value;
    });
  }

  public async listAudit(orgId: string): Promise<AuditRecord[]> {
    const result = await this.pool.query<AuditRow>(SELECT_AUDIT, [orgId]);
    return result.rows.map(auditFromRow);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertOrganization(
  client: PoolClient,
  state: BankState,
  now: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO organizations (id, state, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $3)`,
    [state.orgId, JSON.stringify(state), now],
  );
}

async function insertSession(
  client: PoolClient,
  sessionId: string,
  orgId: string,
  input: CreateSessionInput,
): Promise<void> {
  await client.query(
    `INSERT INTO sessions
      (id, org_id, token_hash, csrf_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sessionId,
      orgId,
      input.tokenHash,
      input.csrfHash,
      input.now,
      input.expiresAt,
    ],
  );
}

async function lockState(
  client: PoolClient,
  orgId: string,
): Promise<BankState> {
  const result = await client.query<OrganizationRow>(
    "SELECT state FROM organizations WHERE id = $1 FOR UPDATE",
    [orgId],
  );
  return stateFromRow(result.rows[0], orgId);
}

async function updateOrganization(
  client: PoolClient,
  orgId: string,
  state: BankState,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE organizations
     SET state = $2::jsonb, updated_at = $3
     WHERE id = $1`,
    [orgId, JSON.stringify(state), now],
  );
}

async function lockLastAudit(
  client: PoolClient,
  orgId: string,
): Promise<AuditRecord | null> {
  const result = await client.query<AuditRow>(SELECT_LAST_AUDIT_FOR_UPDATE, [
    orgId,
  ]);
  const row = result.rows[0];
  return row ? auditFromRow(row) : null;
}

function chainAfter(
  previous: AuditRecord | null,
  drafts: readonly AuditDraft[],
): AuditRecord[] {
  const seed = previous ? [previous] : [];
  return appendAuditChain(seed, drafts).slice(seed.length);
}

async function insertAudits(
  client: PoolClient,
  orgId: string,
  records: readonly AuditRecord[],
): Promise<void> {
  for (const record of records) {
    await client.query(INSERT_AUDIT, auditValues(orgId, record));
  }
}

function auditValues(orgId: string, record: AuditRecord): unknown[] {
  return [
    orgId,
    record.seq,
    record.agent,
    record.action,
    record.objectId,
    record.channel,
    record.status,
    record.detail,
    record.prevHash,
    record.hash,
    new Date(record.recordedAt),
  ];
}

function stateFromRow(
  row: OrganizationRow | undefined,
  orgId: string,
): BankState {
  if (!row) {
    throw new RuntimeError(
      404,
      "ORGANIZATION_NOT_FOUND",
      "A organização da sessão não existe.",
    );
  }
  const state = parseState(row.state, orgId);
  return structuredClone(state);
}

function parseState(value: unknown, orgId: string): BankState {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || !("orgId" in parsed)) {
    throw new Error(`Estado JSONB inválido para a organização ${orgId}.`);
  }
  const state = parsed as BankState;
  if (state.orgId !== orgId) {
    throw new Error(
      `Estado JSONB divergente: recebeu orgId ${state.orgId}, esperado ${orgId}.`,
    );
  }
  return state;
}

function auditFromRow(row: AuditRow): AuditRecord {
  return {
    seq: Number(row.seq),
    agent: row.agent,
    action: row.action,
    objectId: row.object_id,
    channel: row.channel,
    status: row.status,
    detail: row.detail,
    prevHash: row.prev_hash,
    hash: row.hash,
    recordedAt: toIso(row.recorded_at),
  };
}

function identityFromRow(row: SessionRow): SessionIdentity {
  return {
    sessionId: row.session_id,
    orgId: row.org_id,
    displayName: row.display_name,
    expiresAt: toIso(row.expires_at),
  };
}

function identityFromState(
  sessionId: string,
  state: BankState,
  expiresAt: Date,
): SessionIdentity {
  return {
    sessionId,
    orgId: state.orgId,
    displayName: state.displayName,
    expiresAt: expiresAt.toISOString(),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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
