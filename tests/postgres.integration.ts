import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BankApplication } from "../src/runtime/bank-application.js";
import { verifyAuditChain } from "../src/runtime/audit-chain.js";
import { PostgresBankRepository } from "../src/runtime/postgres-repository.js";
import { hashOpaqueToken } from "../src/runtime/session-security.js";

const databaseUrl = process.env.BANK_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "BANK_TEST_DATABASE_URL deve apontar para PostgreSQL descartável de teste.",
  );
const url = new URL(databaseUrl);
if (!url.pathname.endsWith("_test"))
  throw new Error("O nome do banco de teste deve terminar em _test.");
const repository = new PostgresBankRepository({ databaseUrl });
const secondRepository = new PostgresBankRepository({ databaseUrl });
const inspector = new Pool({ connectionString: databaseUrl });
const bank = new BankApplication(repository);
const now = new Date();

beforeAll(async () => {
  await Promise.all([repository.initialize(), secondRepository.initialize()]);
});

afterAll(async () => {
  await Promise.all([
    repository.close(),
    secondRepository.close(),
    inspector.end(),
  ]);
});

describe("PostgreSQL real: transações, isolamento e integridade", () => {
  it("persiste apenas hashes e reencontra a sessão em outra instância", async () => {
    const started = await bank.startSession(null, now);
    const result = await inspector.query<{
      token_hash: string;
      csrf_hash: string;
    }>("SELECT token_hash, csrf_hash FROM sessions WHERE id = $1", [
      started.session.sessionId,
    ]);
    expect(result.rows[0]).toEqual({
      token_hash: hashOpaqueToken(started.sessionToken),
      csrf_hash: hashOpaqueToken(started.csrfToken),
    });
    const restored = await new BankApplication(secondRepository).authenticate(
      started.sessionToken,
      now,
    );
    expect(restored).toEqual(started.session);
    expect(
      await bank.authenticate(
        started.sessionToken,
        new Date(now.getTime() + 9 * 3_600_000),
      ),
    ).toBeNull();
  });

  it("serializa decisões concorrentes e debita exatamente uma vez", async () => {
    const { session } = await bank.startSession(null, now);
    const untouched = (await bank.startSession(null, now)).session;
    const baseline = await bank.cockpit(session);
    const prepared = await bank.command(
      session,
      "Faça um Pix de R$ 100",
      "pg-command-0001",
      now,
    );
    const approval = prepared.approval;
    expect(approval).toBeTruthy();
    if (!approval) throw new Error("Comando deve preparar aprovação.");
    const competingBank = new BankApplication(secondRepository);
    const outcomes = await Promise.allSettled([
      bank.approvalDecision(
        session,
        approval.id,
        "APPROVE",
        approval.version,
        "pg-decision-0001",
        now,
      ),
      competingBank.approvalDecision(
        session,
        approval.id,
        "APPROVE",
        approval.version,
        "pg-decision-0002",
        now,
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const persisted = await competingBank.cockpit(session);
    expect(persisted.money.balanceInCents).toBe(
      baseline.money.balanceInCents - 10_000,
    );
    expect((await bank.cockpit(untouched)).money.balanceInCents).toBe(
      baseline.money.balanceInCents,
    );
    const replay = await bank.command(
      session,
      "Faça um Pix de R$ 100",
      "pg-command-0001",
      now,
    );
    expect(replay).toEqual(prepared);
    expect(verifyAuditChain(await repository.listAudit(session.orgId))).toBe(
      true,
    );
  });

  it("reverte estado e auditoria quando a mutação falha", async () => {
    const { session } = await bank.startSession(null, now);
    const before = await repository.readState(session.orgId);
    await expect(
      repository.mutateState(
        session.orgId,
        (state) => {
          state.balanceInCents = 0;
          throw new Error("Falha induzida antes de COMMIT");
        },
        now,
      ),
    ).rejects.toThrow("Falha induzida");
    expect(await repository.readState(session.orgId)).toEqual(before);
    expect(await repository.listAudit(session.orgId)).toHaveLength(1);
  });

  it("impede UPDATE, DELETE e TRUNCATE acidentais na auditoria", async () => {
    await bank.startSession(null, now);
    for (const query of [
      "UPDATE audit_records SET detail = 'changed'",
      "DELETE FROM audit_records",
      "TRUNCATE audit_records",
    ]) {
      await expect(inspector.query(query)).rejects.toThrow("append-only");
    }
  });
});
