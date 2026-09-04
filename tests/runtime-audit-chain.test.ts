import { describe, expect, it } from "vitest";

import {
  appendAuditChain,
  verifyAuditChain,
} from "../src/runtime/audit-chain.js";
import type { AuditDraft } from "../src/runtime/contracts.js";

function draft(detail: string): AuditDraft {
  return {
    agent: "Agente de Teste",
    action: "TESTE_EXECUTADO",
    objectId: "test-object",
    channel: "SYSTEM",
    status: "CONCLUÍDO",
    detail,
    recordedAt: "2026-09-04T12:00:00.000Z",
  };
}

describe("cadeia de auditoria do runtime", () => {
  it("encadeia eventos e detecta adulteração", () => {
    const records = appendAuditChain([], [draft("primeiro"), draft("segundo")]);

    expect(records).toHaveLength(2);
    expect(records[1]?.prevHash).toBe(records[0]?.hash);
    expect(verifyAuditChain(records)).toBe(true);

    const tampered = records.map((record) => ({ ...record }));
    if (tampered[0]) tampered[0] = { ...tampered[0], detail: "alterado" };
    expect(verifyAuditChain(tampered)).toBe(false);
  });
});
