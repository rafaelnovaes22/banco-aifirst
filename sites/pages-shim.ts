// PORQUÊ: no github.io não há backend. Este módulo intercepta fetch para
// /api/v1/* e /health e responde com o pages-store em localStorage, sem rede.
// Fora do github.io (Railway, localhost com backend) ele não faz nada e o
// cockpit fala com o Fastify normalmente. Ativação também via ?static=1.
import { errorEnvelope } from "./http.ts";
import {
  createPagesStore,
  isPagesExpired,
  pagesAudit,
  pagesAuditCsv,
  pagesCockpit,
  pagesCommand,
  pagesDecision,
  pagesGovernance,
  parsePagesStore,
  requirePagesCsrf,
  serializePagesStore,
  type PagesStore,
} from "./pages-store.ts";
import { HttpError } from "./validation.ts";

const STORAGE_KEY = "fluxo-pages-v1";
const SESSION_PATH = "/api/v1/session";
const LOGOUT_PATH = "/api/v1/logout";

let memoryFallback: string | null = null;
let originalFetch: typeof fetch | null = null;

export function isPagesHost(): boolean {
  const host = window.location.hostname;
  if (host.endsWith(".github.io")) return true;
  if (window.location.protocol === "file:") return true;
  return new URLSearchParams(window.location.search).has("static");
}

export function installPagesShim(): void {
  if (originalFetch || !isPagesHost()) return;
  originalFetch = window.fetch.bind(window);
  window.fetch = pagesFetch as typeof fetch;
}

function restorePagesStore(): PagesStore | null {
  const raw = readPersisted();
  if (!raw) return null;
  try {
    return parsePagesStore(raw);
  } catch {
    return null;
  }
}

function persistPagesStore(store: PagesStore): void {
  writePersisted(serializePagesStore(store));
}

function clearPagesStore(): void {
  writePersisted(null);
}

function readPersisted(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

function writePersisted(raw: string | null): void {
  memoryFallback = raw;
  try {
    if (raw) window.localStorage.setItem(STORAGE_KEY, raw);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // PORQUÊ: modo privado sem storage cai para memória da aba. A demo segue.
  }
}

async function pagesFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const path = new URL(request.url, window.location.origin).pathname;
  if (!path.startsWith("/api/") && path !== "/health") {
    return (originalFetch as typeof fetch)(request);
  }
  try {
    return await routePages(request, path);
  } catch (error) {
    const envelope = errorEnvelope(error);
    return Response.json(envelope.body, { status: envelope.status });
  }
}

async function routePages(request: Request, path: string): Promise<Response> {
  if (path === "/health") return pagesHealth();
  if (path === SESSION_PATH && request.method === "POST") return newPagesSession();
  const store = restorePagesStore();
  if (!store) throw new HttpError(401, "Abra uma nova demonstração.");
  if (path === LOGOUT_PATH) return pagesLogout();
  if (request.method === "GET") return readPagesRoute(store, path);
  if (request.method !== "POST") throw new HttpError(405, "Método não permitido.");
  requirePagesCsrf(store, request.headers.get("x-csrf-token") ?? "");
  return writePagesRoute(store, request, path);
}

function readPagesRoute(store: PagesStore, path: string): Response {
  const now = new Date();
  if (path === "/api/v1/cockpit") {
    const response = Response.json(pagesCockpit(store, now));
    persistPagesStore(store);
    return response;
  }
  if (path === "/api/v1/audit" || path.startsWith("/api/v1/audit?")) {
    return Response.json(pagesAudit(store, now));
  }
  if (path === "/api/v1/audit/export") {
    return new Response(pagesAuditCsv(store, now), {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }
  if (path === "/api/v1/governance") return Response.json(pagesGovernance());
  throw new HttpError(404, "Operação não encontrada.");
}

async function writePagesRoute(
  store: PagesStore,
  request: Request,
  path: string,
): Promise<Response> {
  const now = new Date();
  const body = await readPagesBody(request);
  const key = request.headers.get("idempotency-key");
  if (path === "/api/v1/commands") {
    const payload = await pagesCommand(store, body, key, now);
    persistPagesStore(store);
    return Response.json(payload, { status: 200 });
  }
  const decision = /^\/api\/v1\/approvals\/([^/]+)\/decisions$/.exec(path);
  if (decision?.[1]) return decidePagesRoute(store, decision[1], body, key, now);
  throw new HttpError(404, "Operação não encontrada.");
}

async function decidePagesRoute(
  store: PagesStore,
  rawId: string,
  body: Record<string, unknown>,
  key: string | null,
  now: Date,
): Promise<Response> {
  const result = await pagesDecision(store, rawId, body, key, now);
  persistPagesStore(store);
  if (result.blocked) {
    return Response.json(
      {
        ...result.payload,
        error: {
          code: "POLICY_BLOCKED",
          message: (result.payload["detail"] as string) ?? "Operação bloqueada pela política.",
        },
      },
      { status: 403 },
    );
  }
  return Response.json(result.payload, { status: 200 });
}

async function newPagesSession(): Promise<Response> {
  const now = new Date();
  const store = await createPagesStore(now);
  persistPagesStore(store);
  return Response.json(sessionPayload(store));
}

function pagesLogout(): Response {
  clearPagesStore();
  return Response.json({ authenticated: false });
}

function pagesHealth(): Response {
  return Response.json({
    status: "ok",
    mode: "sandbox",
    version: "0.1.0",
    live_finance: false,
    storage: "localStorage",
  });
}

function sessionPayload(store: PagesStore): Record<string, unknown> {
  return {
    csrfToken: store.csrf,
    session: {
      sessionId: store.sessionId,
      orgId: store.orgId,
      displayName: "Novaes Comércio Ltda.",
      expiresAt: new Date(store.expiresAt).toISOString(),
    },
  };
}

async function readPagesBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = (await request.json()) as unknown;
  } catch {
    throw new HttpError(422, "JSON inválido: esperado objeto UTF-8.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new HttpError(422, "JSON inválido: esperado objeto UTF-8.");
  }
  return value as Record<string, unknown>;
}

export function isPagesSessionFresh(now: Date): boolean {
  const store = restorePagesStore();
  return !!store && !isPagesExpired(store, now);
}

installPagesShim();
