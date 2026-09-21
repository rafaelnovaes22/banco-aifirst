import { createHash, randomBytes } from "node:crypto";

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_LIFETIME_MS);
}

export function parseCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === cookieName) return decodeCookieValue(rawValue.join("="));
  }
  return null;
}

function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function serializeSessionCookie(
  name: string,
  token: string,
  secure: boolean,
): string {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_LIFETIME_MS / 1_000}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function isTrustedOrigin(
  origin: string | undefined,
  expectedOrigin: string,
): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
