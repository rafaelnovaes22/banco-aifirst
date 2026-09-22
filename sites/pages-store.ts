// PORQUÊ: github.io é estático, sem Postgres ou Worker. Este store executa o
// mesmo motor do Sites (bank-engine) dentro do navegador e persiste a sessão em
// localStorage. Paridade de contratos com /api/v1 para o cockpit não mudar.
// Nenhum dinheiro real, nenhuma rede, nenhuma chave fora do dispositivo.
import { auditStatus } from "./audit.ts";
import { decideBankApproval, runBankCommand } from "./bank-engine.ts";
import { createDemoBankState, toCockpitView } from "./bank-state.ts";
import { identifier, sha256, stableJson } from "./crypto.ts";
import { governance } from "./governance.ts";
import type { AuditDraft, BankState } from "./types.ts";
import {
  approvalId,
  exactFields,
  HttpError,
  idempotencyKey,
  textField,
} from "./validation.ts";

export const PAGES_STORAGE_VERSION = 1;
export const PAGES_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;
export const PAGES_AUDIT_LIMIT = 1_000;
export const PAGES_STATE_BYTES = 750_000;

export interface PagesAuditRecord {
  seq: number;
  recordedAt: string;
  agent: string;
  action: string;
  objectId: string;
  channel: string;
  status: string;
  detail: string;
  prevHash: string;
  hash: string;
}

export interface PagesStore {
  version: number;
  sessionId: string;
  orgId: string;
  actorId: string;
  approverId: string;
  csrf: string;
  createdAt: number;
  expiresAt: number;
  state: BankState;
  audits: PagesAuditRecord[];
  head: string;
}

export async function createPagesStore(now: Date): Promise<PagesStore> {
  const sessionId = identifier(16);
  const store: PagesStore = {
    version: PAGES_STORAGE_VERSION,
    sessionId,
    orgId: sessionId,
    actorId: identifier(16),
    approverId: identifier(16),
    csrf: identifier(32),
    createdAt: now.getTime(),
    expiresAt: now.getTime() + PAGES_SESSION_LIFETIME_MS,
    state: createDemoBankState(sessionId, now),
    audits: [],
    head: "",
  };
  await appendPagesAudits(
    store,
    [{ agent: "Sistema", action: "SESSÃO_CRIADA", resourceId: sessionId, payload: { mode: "pages" } }],
    now,
  );
  return store;
}

export function isPagesExpired(store: PagesStore, now: Date): boolean {
  return store.expiresAt <= now.getTime();
}

export function requirePagesSession(store: PagesStore, now: Date): void {
  if (isPagesExpired(store, now)) {
    throw new HttpError(401, "A sessão segura expirou. Abra uma nova demonstração.");
  }
}

export function requirePagesCsrf(store: PagesStore, supplied: string): void {
  // PORQUÊ: sem cookie HttpOnly no Pages, a comparação direta com o token da
  // sessão é o melhor vínculo disponível entre aba e store local.
  if (!supplied || supplied !== store.csrf) {
    throw new HttpError(403, "O token de proteção da sessão está ausente.");
  }
}

export async function pagesCommand(
  store: PagesStore,
  body: Record<string, unknown>,
  keyHeader: string | null,
  now: Date,
): Promise<Record<string, unknown>> {
  requirePagesSession(store, now);
  exactFields(body, ["text"]);
  const text = textField(body, "text", 1, 1000);
  const key = idempotencyKey(keyHeader);
  const outcome = runBankCommand(store.state, store.actorId, text, key, now);
  await appendPagesAudits(store, outcome.audits, now);
  assertPagesLimits(store);
  return outcome.value as Record<string, unknown>;
}

export async function pagesDecision(
  store: PagesStore,
  rawId: string,
  body: Record<string, unknown>,
  keyHeader: string | null,
  now: Date,
): Promise<{ blocked: boolean; payload: Record<string, unknown> }> {
  requirePagesSession(store, now);
  exactFields(body, ["decision", "expectedVersion"]);
  if (body["decision"] !== "APPROVE" && body["decision"] !== "REJECT") {
    throw new HttpError(422, "Decisão inválida: use APPROVE ou REJECT.");
  }
  if (typeof body["expectedVersion"] !== "number" || !Number.isInteger(body["expectedVersion"])) {
    throw new HttpError(422, "Versão esperada inválida.");
  }
  const key = idempotencyKey(keyHeader);
  // PORQUÊ: maker-checker com papéis distintos na mesma sessão. O agente cria
  // com actorId e só o papel humano (approverId) aprova. O agente nunca aprova
  // a própria preparação, mesmo sem segundo usuário no navegador.
  const outcome = decideBankApproval(
    store.state,
    store.approverId,
    approvalId(decodeURIComponent(rawId)),
    body["decision"],
    body["expectedVersion"],
    key,
    now,
  );
  await appendPagesAudits(store, outcome.audits, now);
  assertPagesLimits(store);
  if (outcome.value.blocked === true) {
    return { blocked: true, payload: outcome.value as unknown as Record<string, unknown> };
  }
  return { blocked: false, payload: outcome.value as unknown as Record<string, unknown> };
}

export function pagesCockpit(store: PagesStore, now: Date): Record<string, unknown> {
  requirePagesSession(store, now);
  return toCockpitView(store.state, store.sessionId);
}

export function pagesAudit(store: PagesStore, now: Date, limit = 50): Record<string, unknown> {
  requirePagesSession(store, now);
  const records = store.audits
    .slice(-Math.max(1, Math.min(limit, 100)))
    .reverse()
    .map((entry) => ({
      seq: entry.seq,
      recordedAt: entry.recordedAt,
      agent: entry.agent,
      action: entry.action,
      objectId: entry.objectId,
      channel: entry.channel,
      status: entry.status,
      detail: entry.detail,
      prevHash: entry.prevHash,
      hash: entry.hash,
    }));
  return {
    records,
    integrity: verifyPagesChain(store) ? "VERIFIED" : "COMPROMISED",
    scope: "Cadeia local verificável neste navegador; sem ancoragem externa.",
  };
}

export function pagesAuditCsv(store: PagesStore, now: Date): string {
  requirePagesSession(store, now);
  const header = "seq,recordedAt,agent,action,objectId,channel,status,detail,prevHash,hash";
  const lines = store.audits.map((entry) =>
    [
      entry.seq,
      entry.recordedAt,
      entry.agent,
      entry.action,
      entry.objectId,
      entry.channel,
      entry.status,
      entry.detail,
      entry.prevHash,
      entry.hash,
    ]
      .map(pagesCsvCell)
      .join(","),
  );
  return `\uFEFF${[header, ...lines].join("\n")}`;
}

export function pagesGovernance(): Record<string, unknown> {
  const base = governance();
  const extra = "Demonstração no navegador: dados ficam neste dispositivo e saem com a limpeza do site.";
  return {
    ...base,
    storage: "localStorage",
    limitations: [...(base["limitations"] as string[]), extra],
  };
}

export function serializePagesStore(store: PagesStore): string {
  return JSON.stringify(store);
}

export function parsePagesStore(raw: string): PagesStore {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(503, "Estado da demonstração ilegível.");
  }
  if (!value || typeof value !== "object") {
    throw new HttpError(503, "Estado da demonstração ilegível.");
  }
  const store = value as PagesStore;
  if (store.version !== PAGES_STORAGE_VERSION || !store.state || !Array.isArray(store.audits)) {
    throw new HttpError(503, "Estado da demonstração ilegível.");
  }
  return store;
}

async function appendPagesAudits(
  store: PagesStore,
  drafts: AuditDraft[],
  now: Date,
): Promise<void> {
  if (store.audits.length + drafts.length > PAGES_AUDIT_LIMIT) {
    throw new HttpError(429, "Limite de eventos da demonstração atingido.");
  }
  for (const [offset, draft] of drafts.entries()) {
    const record = await buildPagesRecord(store, draft, offset, now);
    store.audits.push(record);
    store.head = record.hash;
  }
}

async function buildPagesRecord(
  store: PagesStore,
  draft: AuditDraft,
  offset: number,
  now: Date,
): Promise<PagesAuditRecord> {
  const seq = store.audits.length + offset + 1;
  const id = identifier();
  const createdAt = now.toISOString();
  const prevHash = store.head;
  const hash = await sha256(
    stableJson({
      org_id: store.sessionId,
      sequence: seq,
      id,
      created_at: createdAt,
      actor: store.actorId,
      action: draft.action,
      resource_id: draft.resourceId,
      payload: stableJson(draft.payload),
      previous_hash: prevHash,
    }),
  );
  return {
    seq,
    recordedAt: createdAt,
    agent: resolvePagesAgent(draft),
    action: draft.action,
    objectId: draft.resourceId,
    channel: "PANEL",
    status: auditStatus(draft.action),
    detail: draft.action,
    prevHash,
    hash,
  };
}

function resolvePagesAgent(draft: AuditDraft): string {
  if (draft.action.startsWith("SESSÃO_")) return "Sistema";
  if (draft.action === "APROVAÇÃO_CONFIRMADA" || draft.action === "APROVAÇÃO_RECUSADA") {
    return "Responsável humano";
  }
  if (draft.action === "APROVAÇÃO_BLOQUEADA") return "Política de alçada";
  return "Orquestrador";
}

function verifyPagesChain(store: PagesStore): boolean {
  if (store.audits.length === 0) return store.head === "";
  let previous = "";
  for (const [position, entry] of store.audits.entries()) {
    if (entry.seq !== position + 1 || entry.prevHash !== previous) return false;
    previous = entry.hash;
  }
  return previous === store.head;
}

function assertPagesLimits(store: PagesStore): void {
  const bytes = new TextEncoder().encode(JSON.stringify(store.state)).length;
  if (bytes > PAGES_STATE_BYTES) {
    throw new HttpError(413, "Armazenamento da demonstração excede o limite.");
  }
}

function pagesCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
