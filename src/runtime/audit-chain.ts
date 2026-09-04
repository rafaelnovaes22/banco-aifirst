import { createHash } from "node:crypto";

import type { AuditDraft, AuditRecord } from "./contracts.js";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

function canonicalPayload(
  seq: number,
  previousHash: string,
  draft: AuditDraft,
): string {
  return JSON.stringify({
    seq,
    previousHash,
    recordedAt: draft.recordedAt,
    agent: draft.agent,
    action: draft.action,
    objectId: draft.objectId,
    channel: draft.channel,
    status: draft.status,
    detail: draft.detail,
  });
}

export function calculateAuditHash(
  seq: number,
  previousHash: string,
  draft: AuditDraft,
): string {
  return createHash("sha256")
    .update(canonicalPayload(seq, previousHash, draft))
    .digest("hex");
}

export function appendAuditChain(
  existing: readonly AuditRecord[],
  drafts: readonly AuditDraft[],
): AuditRecord[] {
  const records = [...existing];
  for (const draft of drafts) records.push(createAuditRecord(records, draft));
  return records;
}

function createAuditRecord(
  existing: readonly AuditRecord[],
  draft: AuditDraft,
): AuditRecord {
  const previous = existing.at(-1);
  const seq = (previous?.seq ?? 0) + 1;
  const prevHash = previous?.hash ?? AUDIT_GENESIS_HASH;
  return {
    ...draft,
    seq,
    prevHash,
    hash: calculateAuditHash(seq, prevHash, draft),
  };
}

export function verifyAuditChain(records: readonly AuditRecord[]): boolean {
  let previousHash = AUDIT_GENESIS_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || !isValidRecord(record, index + 1, previousHash))
      return false;
    previousHash = record.hash;
  }
  return true;
}

function isValidRecord(
  record: AuditRecord,
  expectedSeq: number,
  expectedPreviousHash: string,
): boolean {
  if (record.seq !== expectedSeq || record.prevHash !== expectedPreviousHash)
    return false;
  return (
    record.hash === calculateAuditHash(record.seq, record.prevHash, record)
  );
}
