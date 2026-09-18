import { auditEntries, insertAudit } from "./audit.ts";
import { createDemoBankState } from "./bank-state.ts";
import { identifier, sha256 } from "./crypto.ts";
import { rateLimit } from "./persistence.ts";
import type { BankRow, SqlDatabase } from "./types.ts";
import { HttpError } from "./validation.ts";

// PORQUÊ: sessão de 8 horas igual ao runtime Node. Token opaco, só hash em disco.
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const COOKIE_NAME = "fluxo_session";

export async function tokenHash(request: Request): Promise<string> {
  const cookies = (request.headers.get("cookie") ?? "").split(";");
  const matches = cookies
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return sha256("");
  const token = matches[0]?.slice(COOKIE_NAME.length + 1) ?? "";
  return sha256(/^[A-Za-z0-9_-]{43}$/.test(token) ? token : "");
}

export function opaqueToken(): string {
  const sample = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...sample);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function sessionCookie(token: string, origin: string): string {
  const maxAge = token ? SESSION_LIFETIME_MS / 1_000 : 0;
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

export function sessionPayload(row: BankRow): Record<string, unknown> {
  return {
    csrfToken: row.csrf_token,
    session: {
      sessionId: row.id,
      orgId: row.org_id,
      displayName: "Novaes Comércio Ltda.",
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}

export async function createDemo(
  db: SqlDatabase,
  oldHash: string,
): Promise<{ token: string; row: BankRow }> {
  await rateLimit(db, "new-demo", 15, 3_600_000);
  const count = await db
    .prepare("SELECT COUNT(*) AS total FROM banco_sessions")
    .first<{ total: number }>();
  if (!count || count.total >= 300) {
    throw new HttpError(429, "Limite de demonstrações atingido.");
  }
  const token = opaqueToken();
  const id = identifier(16);
  const row: BankRow = {
    id,
    org_id: id,
    actor_id: identifier(16),
    token_hash: await sha256(token),
    csrf_token: identifier(32),
    expires_at: Date.now() + SESSION_LIFETIME_MS,
    revision: 0,
    state_json: JSON.stringify(createDemoBankState(id, new Date())),
    audit_head: "",
    audit_count: 0,
  };
  await persistDemo(db, row, oldHash);
  return { token, row };
}

async function persistDemo(
  db: SqlDatabase,
  row: BankRow,
  oldHash: string,
): Promise<void> {
  const entries = await auditEntries(row, [
    {
      agent: "Sistema",
      action: "SESSÃO_CRIADA",
      resourceId: row.id,
      payload: { mode: "sandbox" },
    },
  ]);
  row.audit_head = entries[0]?.hash ?? "";
  row.audit_count = entries.length;
  const mutation = identifier(16);
  await db.batch([
    db
      .prepare("UPDATE banco_sessions SET token_hash=NULL WHERE token_hash=?")
      .bind(oldHash),
    db
      .prepare(
        "INSERT INTO banco_sessions(id,org_id,actor_id,token_hash,csrf_token,expires_at,revision,state_json,audit_head,audit_count,mutation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        row.org_id,
        row.actor_id,
        row.token_hash,
        row.csrf_token,
        row.expires_at,
        row.revision,
        row.state_json,
        row.audit_head,
        row.audit_count,
        mutation,
      ),
    ...entries.map((entry) => insertAudit(db, entry, mutation)),
  ]);
}

export async function requireCsrf(
  request: Request,
  row: BankRow,
): Promise<void> {
  const supplied = request.headers.get("x-csrf-token") ?? "";
  if (
    !supplied ||
    (await sha256(supplied)) !== (await sha256(row.csrf_token))
  ) {
    throw new HttpError(403, "O token de proteção da sessão está ausente.");
  }
}
