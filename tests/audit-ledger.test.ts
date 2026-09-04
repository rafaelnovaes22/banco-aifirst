import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  verifyAuditChain,
  type AuditEvent,
} from "../src/domain/audit-ledger.js";

function buildChainWithTwoEvents(): AuditEvent[] {
  const first = appendAuditEvent([], {
    actorId: "user-1",
    action: "PIX_OUT_REQUESTED",
    objectId: "tx-1",
    channel: "WHATSAPP",
    baasRef: "baas-abc",
    payloadJson: '{"amountInCents":10000}',
  });
  return [
    first,
    appendAuditEvent([first], {
      actorId: "user-1",
      action: "PIX_OUT_CONFIRMED",
      objectId: "tx-1",
      channel: "SYSTEM",
      baasRef: "baas-abc",
      payloadJson: '{"amountInCents":10000}',
    }),
  ];
}

describe("audit ledger", () => {
  it("encadeia hashes: evento 2 referencia o hash do evento 1", () => {
    const chain = buildChainWithTwoEvents();
    expect(chain).toHaveLength(2);
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[0].prevHash).toBe("0".repeat(64));
  });

  it("verifica cadeia íntegra", () => {
    expect(verifyAuditChain(buildChainWithTwoEvents())).toBe(true);
  });

  it("detecta payload editado retroativamente", () => {
    const [first, second] = buildChainWithTwoEvents();
    const tampered: AuditEvent[] = [
      { ...first, payloadJson: '{"amountInCents":99000}' },
      second,
    ];
    expect(verifyAuditChain(tampered)).toBe(false);
  });

  it("detecta hash forjado", () => {
    const tampered = buildChainWithTwoEvents();
    tampered[1] = { ...tampered[1], hash: "f".repeat(64) };
    expect(verifyAuditChain(tampered)).toBe(false);
  });

  it("detecta evento removido do meio da cadeia", () => {
    const first = buildChainWithTwoEvents();
    const third = appendAuditEvent(first, {
      actorId: "user-2",
      action: "TICKET_RESOLVED",
      objectId: "ticket-7",
      channel: "PANEL",
      payloadJson: "{}",
    });
    expect(verifyAuditChain([first[0], third])).toBe(false);
  });
});
