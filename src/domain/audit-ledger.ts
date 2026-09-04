import { createHash } from "node:crypto";

// PORQUÊ: trilha append-only com hash encadeado. Qualquer edição retroativa
// quebra a cadeia e o verify acusa. É o artefato de auditoria que o sócio e o
// parceiro regulado vão pedir primeiro.

export const GENESIS_HASH = "0".repeat(64);

export type AuditChannel = "WHATSAPP" | "TELEGRAM" | "PANEL" | "SYSTEM";

export interface AuditEventInput {
  readonly actorId: string;
  readonly action: string;
  readonly objectId: string;
  readonly channel: AuditChannel;
  readonly baasRef?: string;
  readonly payloadJson: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eventBody(
  event: AuditEventInput,
  seq: number,
  prevHash: string,
): string {
  return [
    seq,
    event.actorId,
    event.action,
    event.objectId,
    event.channel,
    event.baasRef ?? "",
    event.payloadJson,
    prevHash,
  ].join("|");
}

export function appendAuditEvent(
  chain: readonly AuditEvent[],
  input: AuditEventInput,
): AuditEvent {
  const seq = chain.length + 1;
  const prevHash =
    chain.length === 0 ? GENESIS_HASH : chain[chain.length - 1].hash;
  const hash = sha256(eventBody(input, seq, prevHash));
  return { ...input, seq, prevHash, hash };
}

export function verifyAuditChain(chain: readonly AuditEvent[]): boolean {
  return chain.every((event, index) => {
    const expectedPrevHash = index === 0 ? GENESIS_HASH : chain[index - 1].hash;
    if (event.seq !== index + 1 || event.prevHash !== expectedPrevHash)
      return false;
    return sha256(eventBody(event, event.seq, event.prevHash)) === event.hash;
  });
}
