import { describe, expect, it } from "vitest";

import { MemoryBankRepository } from "../src/runtime/memory-repository.js";

const now = new Date("2026-09-04T12:00:00.000Z");

describe("repositório em memória do runtime", () => {
  it("isola organizações, sessões e tokens CSRF", async () => {
    const repository = new MemoryBankRepository();
    const first = await repository.createSession({
      tokenHash: "token-one",
      csrfHash: "csrf-one",
      now,
      expiresAt: new Date("2026-09-04T20:00:00.000Z"),
    });
    const second = await repository.createSession({
      tokenHash: "token-two",
      csrfHash: "csrf-two",
      now,
      expiresAt: new Date("2026-09-04T20:00:00.000Z"),
    });

    expect(first.orgId).not.toBe(second.orgId);
    expect(await repository.findSession("token-one", now)).toEqual(first);
    expect(await repository.verifyCsrf(first.sessionId, "csrf-two", now)).toBe(
      false,
    );
    expect((await repository.readState(first.orgId)).orgId).toBe(first.orgId);
  });

  it("expira sessão e persiste auditoria de mutação", async () => {
    const repository = new MemoryBankRepository();
    const session = await repository.createSession({
      tokenHash: "expired-token",
      csrfHash: "csrf",
      now,
      expiresAt: new Date("2026-09-04T12:01:00.000Z"),
    });

    expect(
      await repository.findSession(
        "expired-token",
        new Date("2026-09-04T12:02:00.000Z"),
      ),
    ).toBeNull();
    expect(await repository.listAudit(session.orgId)).toHaveLength(1);
  });
});
