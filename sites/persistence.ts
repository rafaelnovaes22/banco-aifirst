import { auditEntries, insertAudit } from "./audit.ts";
import { identifier } from "./crypto.ts";
import type {
  BankRow,
  BankState,
  CommandResult,
  SqlDatabase,
} from "./types.ts";
import { HttpError } from "./validation.ts";

// PORQUÊ: revisão otimista com retry. Concorrência perde e tenta de novo, sem débito duplo.
export async function sessionRow(
  db: SqlDatabase,
  tokenHash: string,
): Promise<BankRow> {
  const row = await db
    .prepare("SELECT * FROM banco_sessions WHERE token_hash=? AND expires_at>?")
    .bind(tokenHash, Date.now())
    .first<BankRow>();
  if (!row) {
    throw new HttpError(
      401,
      "A sessão segura expirou. Abra uma nova demonstração.",
    );
  }
  return row;
}

export async function mutateBankState(
  db: SqlDatabase,
  tokenHash: string,
  command: (state: BankState, row: BankRow) => Promise<CommandResult>,
): Promise<CommandResult> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await sessionRow(db, tokenHash);
    const state = parseState(row.state_json);
    const result = await command(state, row);
    if (await commitMutation(db, row, state, result)) return result;
  }
  throw new HttpError(
    409,
    "Operação concorrente. Recarregue antes de tentar de novo.",
  );
}

function parseState(raw: string): BankState {
  try {
    return JSON.parse(raw) as BankState;
  } catch {
    throw new HttpError(503, "Estado da demonstração ilegível.");
  }
}

async function commitMutation(
  db: SqlDatabase,
  row: BankRow,
  state: BankState,
  result: CommandResult,
): Promise<boolean> {
  if (row.audit_count + result.events.length > 1000) {
    throw new HttpError(429, "Limite de eventos da demonstração atingido.");
  }
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).length > 750000) {
    throw new HttpError(413, "Armazenamento da demonstração excede o limite.");
  }
  const entries = await auditEntries(row, result.events);
  const mutation = identifier(16);
  const update = db
    .prepare(
      `UPDATE banco_sessions SET state_json=?,revision=revision+1,audit_head=?,audit_count=?,mutation_id=?
      WHERE id=? AND revision=? AND token_hash=? AND expires_at>?`,
    )
    .bind(
      serialized,
      entries.at(-1)?.hash ?? row.audit_head,
      row.audit_count + entries.length,
      mutation,
      row.id,
      row.revision,
      row.token_hash,
      Date.now(),
    );
  const results = await db.batch([
    update,
    ...entries.map((entry) => insertAudit(db, entry, mutation)),
  ]);
  return results[0]?.meta.changes === 1;
}

export async function rateLimit(
  db: SqlDatabase,
  bucket: string,
  maximum: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO banco_limits(bucket,count,resets_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN resets_at<=? THEN 1 ELSE count+1 END,
      resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING count`,
    )
    .bind(bucket, now + windowMs, now, now)
    .first<{ count: number }>();
  if (!result || result.count > maximum) {
    throw new HttpError(
      429,
      "Muitas solicitações. Aguarde antes de tentar novamente.",
    );
  }
}
