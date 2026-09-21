import { readAudit } from "./audit.ts";
import { toCockpitView } from "./bank-state.ts";
import { dispatchBankCommand, requireCommandIdempotency } from "./commands.ts";
import { governance } from "./governance.ts";
import {
  DEFAULT_ORIGIN,
  errorEnvelope,
  protectedResponse,
  readInput,
  validateOrigin,
} from "./http.ts";
import { mutateBankState, rateLimit, sessionRow } from "./persistence.ts";
import {
  createDemo,
  requireCsrf,
  sessionCookie,
  sessionPayload,
  tokenHash,
} from "./sessions.ts";
import type { BankRow, BankState, Environment } from "./types.ts";
import { HttpError } from "./validation.ts";

declare const STATIC_FILES: Record<
  string,
  { content: string; mime: string; binary: boolean }
>;

async function fetchSite(
  request: Request,
  env: Environment,
): Promise<Response> {
  const origin = env.PUBLIC_ORIGIN ?? DEFAULT_ORIGIN;
  try {
    validateOrigin(request, origin);
    const response = await route(request, env, origin);
    return protectedResponse(response, origin);
  } catch (error) {
    const envelope = errorEnvelope(error);
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request_failed", status: envelope.status }),
      );
    }
    return protectedResponse(
      Response.json(envelope.body, { status: envelope.status }),
      origin,
    );
  }
}

async function route(
  request: Request,
  env: Environment,
  origin: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/health" && request.method === "GET") return health(env);
  if (!path.startsWith("/api/")) return staticResponse(request, path);
  const hash = await tokenHash(request);
  if (path === "/api/v1/session" && request.method === "POST")
    return newSession(env, hash, origin);
  const row = await sessionRow(env.DB, hash);
  await rateLimit(env.DB, `api:${row.id}`, 180, 60_000);
  if (request.method === "GET") return readRoute(env, row, path);
  if (request.method !== "POST")
    throw new HttpError(405, "Método não permitido.");
  await requireCsrf(request, row);
  const input = await readInput(request);
  if (path === "/api/v1/logout") return logout(env, hash, origin);
  const key = requireCommandIdempotency(request);
  const result = await mutateBankState(env.DB, hash, (state) =>
    dispatchBankCommand(state, row, path, input, key),
  );
  const payload = result.payload as { blocked?: boolean; detail?: string };
  if (payload.blocked === true) {
    return Response.json(
      {
        ...payload,
        error: {
          code: "POLICY_BLOCKED",
          message: payload.detail ?? "Operação bloqueada pela política.",
        },
      },
      { status: 403 },
    );
  }
  return Response.json(result.payload, { status: 200 });
}

async function health(env: Environment): Promise<Response> {
  await env.DB.prepare("SELECT count FROM banco_limits WHERE 0").run();
  return Response.json({
    status: "ok",
    mode: "sandbox",
    version: "0.1.0",
    live_finance: false,
    storage: "d1",
  });
}

function staticResponse(request: Request, path: string): Response {
  if (!["GET", "HEAD"].includes(request.method)) {
    throw new HttpError(405, "Método não permitido.");
  }
  const asset = STATIC_FILES[path === "/" ? "/index.html" : path];
  if (!asset) throw new HttpError(404, "Página não encontrada.");
  if (request.method === "HEAD") {
    return new Response(null, { headers: { "Content-Type": asset.mime } });
  }
  if (asset.binary) {
    const bytes = Uint8Array.from(atob(asset.content), (char) =>
      char.charCodeAt(0),
    );
    return new Response(bytes, { headers: { "Content-Type": asset.mime } });
  }
  return new Response(asset.content, {
    headers: { "Content-Type": asset.mime },
  });
}

async function newSession(
  env: Environment,
  hash: string,
  origin: string,
): Promise<Response> {
  const result = await createDemo(env.DB, hash);
  return Response.json(sessionPayload(result.row), {
    headers: { "Set-Cookie": sessionCookie(result.token, origin) },
  });
}

async function readRoute(
  env: Environment,
  row: BankRow,
  path: string,
): Promise<Response> {
  if (path === "/api/v1/cockpit") {
    const state = JSON.parse(row.state_json) as BankState;
    return Response.json(toCockpitView(state, row.id));
  }
  if (path === "/api/v1/audit" || path.startsWith("/api/v1/audit?")) {
    return Response.json(await readAudit(env.DB, row));
  }
  if (path === "/api/v1/audit/export") return exportAudit(env, row);
  if (path === "/api/v1/governance") return Response.json(governance());
  throw new HttpError(404, "Operação não encontrada.");
}

async function exportAudit(env: Environment, row: BankRow): Promise<Response> {
  const view = (await readAudit(env.DB, row)) as {
    records: Array<Record<string, unknown>>;
  };
  const header =
    "seq,recordedAt,agent,action,objectId,channel,status,detail,prevHash,hash";
  const lines = view.records.map((record) =>
    [
      record["seq"],
      record["recordedAt"],
      record["agent"],
      record["action"],
      record["objectId"],
      record["channel"],
      record["status"],
      record["detail"],
      record["prevHash"],
      record["hash"],
    ]
      .map(csvCell)
      .join(","),
  );
  return new Response(`\uFEFF${[header, ...lines].join("\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fluxo-auditoria.csv"',
    },
  });
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

async function logout(
  env: Environment,
  hash: string,
  origin: string,
): Promise<Response> {
  try {
    await mutateBankState(env.DB, hash, (state) =>
      Promise.resolve({
        payload: {},
        events: [
          {
            agent: "Sistema",
            action: "SESSÃO_ENCERRADA",
            resourceId: state.orgId,
            payload: {},
          },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 429)) throw error;
  } finally {
    await env.DB.prepare(
      "UPDATE banco_sessions SET token_hash=NULL WHERE token_hash=?",
    )
      .bind(hash)
      .run();
  }
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": sessionCookie("", origin) } },
  );
}

export default { fetch: fetchSite };
