import type { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendAuditChain,
  verifyAuditChain,
} from "../src/runtime/audit-chain.js";
import type { AuditRecord } from "../src/runtime/contracts.js";
import { createDemoState } from "../src/runtime/demo-state.js";
import {
  PostgresBankRepository,
  type PostgresPoolFactory,
} from "../src/runtime/postgres-repository.js";

interface RecordedQuery {
  readonly target: "pool" | "client";
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueryResponder = (
  text: string,
  values: readonly unknown[],
) => QueryResult<QueryResultRow>;

class FakePostgres {
  public readonly queries: RecordedQuery[] = [];
  public readonly release = vi.fn();
  public readonly end = vi.fn(async (): Promise<void> => {});
  private responder: QueryResponder = () => queryResult([]);

  public readonly pool = {
    query: async (text: string, values: unknown[] = []) =>
      this.record("pool", text, values),
    connect: vi.fn(async () => this.client),
    end: this.end,
  } as unknown as Pool;

  private readonly client = {
    query: async (text: string, values: unknown[] = []) =>
      this.record("client", text, values),
    release: this.release,
  };

  public respondWith(responder: QueryResponder): void {
    this.responder = responder;
  }

  private record(
    target: RecordedQuery["target"],
    text: string,
    values: readonly unknown[],
  ): QueryResult<QueryResultRow> {
    this.queries.push({ target, text, values });
    return this.responder(text, values);
  }
}

function queryResult<Row extends QueryResultRow>(
  rows: Row[],
): QueryResult<Row> {
  return { command: "", rowCount: rows.length, oid: 0, fields: [], rows };
}

function createRepository(fake: FakePostgres): {
  readonly repository: PostgresBankRepository;
  readonly poolFactory: ReturnType<typeof vi.fn<PostgresPoolFactory>>;
} {
  const poolFactory = vi.fn<PostgresPoolFactory>(() => fake.pool);
  const repository = new PostgresBankRepository({
    databaseUrl: "postgresql://runtime:test@database.test:5432/bank",
    poolFactory,
  });
  return { repository, poolFactory };
}

function normalizedSql(query: RecordedQuery): string {
  return query.text.replace(/\s+/g, " ").trim();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostgresBankRepository configuration", () => {
  it("falha fechado sem DATABASE_URL", () => {
    const poolFactory = vi.fn<PostgresPoolFactory>();
    expect(
      () => new PostgresBankRepository({ databaseUrl: " ", poolFactory }),
    ).toThrow(/DATABASE_URL/);
    expect(poolFactory).not.toHaveBeenCalled();
  });

  it("cria exatamente um Pool com a connection string recebida", () => {
    const fake = new FakePostgres();
    const { poolFactory } = createRepository(fake);
    expect(poolFactory).toHaveBeenCalledTimes(1);
    expect(poolFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://runtime:test@database.test:5432/bank",
      }) satisfies Partial<PoolConfig>,
    );
  });
});

describe("PostgresBankRepository lifecycle", () => {
  it("inicializa schema idempotente e protege auditoria contra alteração", async () => {
    const fake = new FakePostgres();
    const { repository } = createRepository(fake);
    await repository.initialize();

    const sql = fake.queries.map(normalizedSql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(
      sql.filter((statement) => /CREATE TABLE IF NOT EXISTS/i.test(statement)),
    ).toHaveLength(3);
    expect(
      sql.some((statement) =>
        /BEFORE UPDATE OR DELETE ON audit_records/i.test(statement),
      ),
    ).toBe(true);
    expect(fake.queries.every((query) => query.target === "client")).toBe(true);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("faz health com SELECT 1 e fecha o Pool", async () => {
    const fake = new FakePostgres();
    fake.respondWith((text) =>
      /SELECT 1 AS ok/i.test(text) ? queryResult([{ ok: 1 }]) : queryResult([]),
    );
    const { repository } = createRepository(fake);

    await expect(repository.health()).resolves.toBe(true);
    await repository.close();

    expect(normalizedSql(fake.queries[0]!)).toBe("SELECT 1 AS ok");
    expect(fake.queries[0]?.target).toBe("pool");
    expect(fake.end).toHaveBeenCalledOnce();
  });
});

describe("PostgresBankRepository state and audit", () => {
  it("cria organização, sessão e auditoria inicial na mesma transação", async () => {
    const fake = new FakePostgres();
    const { repository } = createRepository(fake);
    const now = new Date("2026-09-04T12:00:00.000Z");

    const session = await repository.createSession({
      tokenHash: "token-hash-secret",
      csrfHash: "csrf-hash-secret",
      now,
      expiresAt: new Date("2026-09-04T20:00:00.000Z"),
    });

    const sql = fake.queries.map(normalizedSql);
    expect(sql).toEqual([
      "BEGIN",
      expect.stringMatching(/^INSERT INTO organizations/i),
      expect.stringMatching(/^INSERT INTO sessions/i),
      expect.stringMatching(/^INSERT INTO audit_records/i),
      "COMMIT",
    ]);
    expect(fake.queries[1]?.values[0]).toBe(session.orgId);
    expect(fake.queries[2]?.values).toContain("token-hash-secret");
    expect(fake.queries[3]?.values[1]).toBe(1);
    expect(fake.queries[3]?.values[8]).toBe("0".repeat(64));
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("bloqueia estado com FOR UPDATE e acrescenta hash encadeado", async () => {
    const fake = new FakePostgres();
    const now = new Date("2026-09-04T13:00:00.000Z");
    const state = createDemoState("org-1", now);
    const previous = previousAudit();
    fake.respondWith((text) => {
      if (/SELECT state FROM organizations/i.test(text)) {
        return queryResult([{ state: structuredClone(state) }]);
      }
      if (/SELECT\s+seq,\s*agent/i.test(text)) {
        return queryResult([auditRow(previous)]);
      }
      return queryResult([]);
    });
    const { repository } = createRepository(fake);

    const value = await repository.mutateState(
      "org-1",
      (mutableState) => {
        mutableState.balanceInCents -= 5_000;
        return {
          value: "updated",
          audits: [
            {
              agent: "Tesouraria",
              action: "SALDO_AJUSTADO",
              objectId: "org-1",
              channel: "SYSTEM",
              status: "CONCLUÍDO",
              detail: "Ajuste sandbox de R$ 50,00.",
              recordedAt: now.toISOString(),
            },
          ],
        };
      },
      now,
    );

    const stateLock = fake.queries.find((query) =>
      /SELECT state FROM organizations/i.test(query.text),
    );
    const update = fake.queries.find((query) =>
      /^\s*UPDATE organizations/i.test(query.text),
    );
    const auditInsert = fake.queries.find((query) =>
      /^\s*INSERT INTO audit_records/i.test(query.text),
    );
    expect(value).toBe("updated");
    expect(stateLock?.text).toMatch(/FOR UPDATE/i);
    expect(stateLock?.values).toEqual(["org-1"]);
    expect(JSON.parse(String(update?.values[1]))).toMatchObject({
      balanceInCents: state.balanceInCents - 5_000,
      version: state.version + 1,
    });
    const appended = auditFromInsert(auditInsert!);
    expect(appended.prevHash).toBe(previous.hash);
    expect(verifyAuditChain([previous, appended])).toBe(true);
  });

  it("reverte e libera o mesmo client quando o mutator falha", async () => {
    const fake = new FakePostgres();
    fake.respondWith((text) =>
      /SELECT state FROM organizations/i.test(text)
        ? queryResult([
            { state: createDemoState("org-1", new Date("2026-09-04")) },
          ])
        : queryResult([]),
    );
    const { repository } = createRepository(fake);

    await expect(
      repository.mutateState(
        "org-1",
        () => {
          throw new Error("mutation failed");
        },
        new Date("2026-09-04"),
      ),
    ).rejects.toThrow("mutation failed");

    expect(fake.queries.map(normalizedSql)).toEqual([
      "BEGIN",
      expect.stringMatching(/FOR UPDATE$/i),
      "ROLLBACK",
    ]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("não grava nem incrementa versão em replay idempotente", async () => {
    const fake = new FakePostgres();
    const state = createDemoState("org-1", new Date("2026-09-04"));
    fake.respondWith((text) =>
      /SELECT state FROM organizations/i.test(text)
        ? queryResult([{ state: structuredClone(state) }])
        : queryResult([]),
    );
    const { repository } = createRepository(fake);

    const value = await repository.mutateState(
      "org-1",
      (mutableState) => {
        mutableState.version += 99;
        return { value: "cached-response", audits: [] };
      },
      new Date("2026-09-04"),
    );

    expect(value).toBe("cached-response");
    expect(fake.queries.map(normalizedSql)).toEqual([
      "BEGIN",
      expect.stringMatching(/FOR UPDATE$/i),
      "COMMIT",
    ]);
  });
});

describe("PostgresBankRepository session and reads", () => {
  it("busca sessão e valida CSRF com parâmetros, sem interpolar segredos", async () => {
    const fake = new FakePostgres();
    const now = new Date("2026-09-04T14:00:00.000Z");
    fake.respondWith((text) => {
      if (/FROM sessions s/i.test(text)) {
        return queryResult([
          {
            session_id: "session-1",
            org_id: "org-1",
            display_name: "Novaes Comércio Ltda.",
            expires_at: "2026-09-04T20:00:00.000Z",
          },
        ]);
      }
      if (/SELECT 1 FROM sessions/i.test(text)) return queryResult([{ ok: 1 }]);
      if (/UPDATE sessions/i.test(text))
        return queryResult([{ id: "session-1" }]);
      return queryResult([]);
    });
    const { repository } = createRepository(fake);

    await expect(repository.findSession("token-hash", now)).resolves.toEqual({
      sessionId: "session-1",
      orgId: "org-1",
      displayName: "Novaes Comércio Ltda.",
      expiresAt: "2026-09-04T20:00:00.000Z",
    });
    await expect(
      repository.verifyCsrf("session-1", "csrf-hash", now),
    ).resolves.toBe(true);
    await repository.rotateCsrf("session-1", "next-csrf-hash");

    expect(fake.queries.map((query) => query.values)).toEqual([
      ["token-hash", now],
      ["session-1", "csrf-hash", now],
      ["session-1", "next-csrf-hash"],
    ]);
    expect(fake.queries.every((query) => query.target === "pool")).toBe(true);
    expect(fake.queries.map((query) => query.text).join(" ")).not.toContain(
      "token-hash",
    );
  });

  it("retorna erro de domínio ao rotacionar CSRF de sessão ausente", async () => {
    const fake = new FakePostgres();
    const { repository } = createRepository(fake);
    await expect(
      repository.rotateCsrf("missing", "csrf-hash"),
    ).rejects.toMatchObject({ statusCode: 401, code: "SESSION_NOT_FOUND" });
  });

  it("lê o estado JSONB e a cadeia de auditoria em ordem", async () => {
    const fake = new FakePostgres();
    const state = createDemoState("org-1", new Date("2026-09-04"));
    const audit = previousAudit();
    fake.respondWith((text) => {
      if (/SELECT state FROM organizations/i.test(text)) {
        return queryResult([{ state: JSON.stringify(state) }]);
      }
      if (/FROM audit_records/i.test(text))
        return queryResult([auditRow(audit)]);
      return queryResult([]);
    });
    const { repository } = createRepository(fake);

    await expect(repository.readState("org-1")).resolves.toEqual(state);
    await expect(repository.listAudit("org-1")).resolves.toEqual([audit]);

    const auditQuery = fake.queries.at(-1)!;
    expect(auditQuery.text).toMatch(/ORDER BY seq ASC/i);
    expect(auditQuery.values).toEqual(["org-1"]);
  });
});

function previousAudit(): AuditRecord {
  const [record] = appendAuditChain(
    [],
    [
      {
        agent: "Sistema",
        action: "SANDBOX_CRIADO",
        objectId: "organization",
        channel: "SYSTEM",
        status: "CONCLUÍDO",
        detail: "Ambiente demonstrativo criado.",
        recordedAt: "2026-09-04T12:00:00.000Z",
      },
    ],
  );
  return record!;
}

function auditRow(record: AuditRecord): QueryResultRow {
  return {
    seq: record.seq,
    agent: record.agent,
    action: record.action,
    object_id: record.objectId,
    channel: record.channel,
    status: record.status,
    detail: record.detail,
    prev_hash: record.prevHash,
    hash: record.hash,
    recorded_at: record.recordedAt,
  };
}

function auditFromInsert(query: RecordedQuery): AuditRecord {
  return {
    seq: Number(query.values[1]),
    agent: String(query.values[2]),
    action: String(query.values[3]),
    objectId: String(query.values[4]),
    channel: query.values[5] as AuditRecord["channel"],
    status: query.values[6] as AuditRecord["status"],
    detail: String(query.values[7]),
    prevHash: String(query.values[8]),
    hash: String(query.values[9]),
    recordedAt: new Date(query.values[10] as Date).toISOString(),
  };
}
