import { identifier, sha256, stableJson } from "./crypto.ts";
import type {
  AuditDraft,
  BankRow,
  SqlDatabase,
  SqlStatement,
} from "./types.ts";

// PORQUÊ: cadeia com hash encadeado por sessão. Administrador do banco ainda pode
// alterar registros, então sem ancoragem externa não há imutabilidade absoluta.
export interface StoredAudit {
  org_id: string;
  sequence: number;
  id: string;
  created_at: string;
  actor: string;
  action: string;
  resource_id: string;
  payload: string;
  previous_hash: string;
  hash: string;
}

export async function auditEntries(
  row: BankRow,
  drafts: AuditDraft[],
): Promise<StoredAudit[]> {
  let previous = row.audit_head;
  const entries: StoredAudit[] = [];
  for (const [offset, draft] of drafts.entries()) {
    const entry: StoredAudit = {
      org_id: row.id,
      sequence: row.audit_count + offset + 1,
      id: identifier(),
      created_at: new Date().toISOString(),
      actor: row.actor_id,
      action: draft.action,
      resource_id: draft.resourceId,
      payload: stableJson(draft.payload),
      previous_hash: previous,
      hash: "",
    };
    entry.hash = await auditDigest(entry);
    entries.push(entry);
    previous = entry.hash;
  }
  return entries;
}

function auditDigest(entry: StoredAudit): Promise<string> {
  const content = {
    org_id: entry.org_id,
    sequence: entry.sequence,
    id: entry.id,
    created_at: entry.created_at,
    actor: entry.actor,
    action: entry.action,
    resource_id: entry.resource_id,
    payload: entry.payload,
    previous_hash: entry.previous_hash,
  };
  return sha256(stableJson(content));
}

export function insertAudit(
  db: SqlDatabase,
  entry: StoredAudit,
  mutation: string,
): SqlStatement {
  // PORQUÊ: batch D1 é transacional. Auditoria só entra se o compare-and-swap venceu.
  return db
    .prepare(
      `INSERT INTO banco_audit
      (org_id,sequence,id,created_at,actor,action,resource_id,payload,previous_hash,hash)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS
      (SELECT 1 FROM banco_sessions WHERE id=? AND mutation_id=?)`,
    )
    .bind(
      entry.org_id,
      entry.sequence,
      entry.id,
      entry.created_at,
      entry.actor,
      entry.action,
      entry.resource_id,
      entry.payload,
      entry.previous_hash,
      entry.hash,
      entry.org_id,
      mutation,
    );
}

const ACTION_STATUS: Array<[RegExp, string]> = [
  [/BLOQUEAD|RECUSAD/i, "RECUSADO"],
  [/APROVAÇÃO_CRIADA/i, "AGUARDANDO"],
  [/CONFIRMADA|APROVAD/i, "APROVADO"],
];

export function auditStatus(action: string): string {
  for (const [pattern, status] of ACTION_STATUS) {
    if (pattern.test(action)) return status;
  }
  return "CONCLUÍDO";
}

export async function readAudit(
  db: SqlDatabase,
  row: BankRow,
): Promise<Record<string, unknown>> {
  const snapshot = await db.batch([
    db
      .prepare("SELECT audit_count,audit_head FROM banco_sessions WHERE id=?")
      .bind(row.id),
    db
      .prepare("SELECT * FROM banco_audit WHERE org_id=? ORDER BY sequence")
      .bind(row.id),
  ]);
  const head = snapshot[0]?.results[0] as
    { audit_count: number; audit_head: string } | undefined;
  const entries = (snapshot[1]?.results ?? []) as unknown as StoredAudit[];
  let previous = "";
  let verified = head !== undefined && entries.length === head.audit_count;
  for (const [position, entry] of entries.entries()) {
    const digest = await auditDigest(entry);
    verified =
      verified &&
      entry.sequence === position + 1 &&
      entry.previous_hash === previous &&
      entry.hash === digest;
    previous = entry.hash;
  }
  const records = entries
    .slice(-100)
    .reverse()
    .map((entry) => ({
      seq: entry.sequence,
      recordedAt: entry.created_at,
      agent:
        entry.actor === row.actor_id ? actionAgent(entry.action) : entry.actor,
      action: entry.action,
      objectId: entry.resource_id,
      channel: "PANEL",
      status: auditStatus(entry.action),
      detail: entry.action,
      prevHash: entry.previous_hash,
      hash: entry.hash,
    }));
  return {
    records,
    integrity:
      verified && previous === head?.audit_head ? "VERIFIED" : "COMPROMISED",
    scope: "Cadeia D1 verificável; sem ancoragem externa imutável.",
  };
}

function actionAgent(action: string): string {
  if (action.startsWith("SESSÃO_")) return "Sistema";
  if (action === "APROVAÇÃO_CONFIRMADA" || action === "APROVAÇÃO_RECUSADA") {
    return "Responsável humano";
  }
  if (action === "APROVAÇÃO_BLOQUEADA") return "Política de alçada";
  return "Orquestrador";
}
