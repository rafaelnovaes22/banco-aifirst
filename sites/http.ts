import { HttpError } from "./validation.ts";

// PORQUÊ: origem padrão é placeholder. O domínio final entra via PUBLIC_ORIGIN no deploy.
export const DEFAULT_ORIGIN = "https://banco-aifirst.chatgpt.site";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";

export function protectedResponse(
  response: Response,
  origin: string,
): Response {
  const headers = new Headers(response.headers);
  const hardened: Record<string, string> = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  for (const [key, value] of Object.entries(hardened)) headers.set(key, value);
  if (origin.startsWith("https:")) {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return new Response(response.body, { status: response.status, headers });
}

export function validateOrigin(request: Request, origin: string): void {
  if (new URL(request.url).origin !== origin) {
    throw new HttpError(400, "Host inválido.");
  }
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    throw new HttpError(405, "Método não permitido.");
  }
  if (request.method === "POST" && request.headers.get("origin") !== origin) {
    throw new HttpError(403, "Origem não autorizada.");
  }
}

export function errorEnvelope(error: unknown): {
  status: number;
  body: unknown;
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { code: httpCode(error.status), message: error.message } },
    };
  }
  return {
    status: 503,
    body: {
      error: {
        code: "UNAVAILABLE",
        message: "Serviço temporariamente indisponível.",
      },
    },
  };
}

function httpCode(status: number): string {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "SESSION_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "LIMIT_EXCEEDED";
  if (status === 415) return "UNSUPPORTED_MEDIA";
  if (status === 422) return "INVALID_BODY";
  if (status === 429) return "RATE_LIMITED";
  return "UNAVAILABLE";
}

export async function readInput(
  request: Request,
): Promise<Record<string, unknown>> {
  const media = request.headers.get("content-type")?.split(";")[0];
  if (media !== "application/json") {
    throw new HttpError(415, "Envie application/json.");
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 32768) {
      await reader.cancel();
      throw new HttpError(413, "Documento excede o limite permitido.");
    }
    chunks.push(next.value);
  }
  return parseObject(chunks, length);
}

function parseObject(
  chunks: Uint8Array[],
  length: number,
): Record<string, unknown> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("expected object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(422, "JSON inválido: esperado objeto UTF-8.");
  }
}
