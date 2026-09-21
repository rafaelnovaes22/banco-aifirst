import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  hashOpaqueToken,
  isTrustedOrigin,
  parseCookie,
  serializeSessionCookie,
  sessionExpiry,
} from "../src/runtime/session-security.js";

describe("segurança de sessão do runtime", () => {
  it("gera tokens fortes e persiste somente hash determinístico", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashOpaqueToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(first)).toBe(hashOpaqueToken(first));
  });

  it("serializa cookie host-only e recupera seu valor", () => {
    const cookie = serializeSessionCookie(
      "__Host-fluxo_session",
      "opaque/value",
      true,
    );

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(parseCookie(cookie, "__Host-fluxo_session")).toBe("opaque/value");
  });

  it("aceita somente a origem exata e expira em oito horas", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");

    expect(
      isTrustedOrigin("https://bank.example/path", "https://bank.example"),
    ).toBe(true);
    expect(
      isTrustedOrigin("https://evil.example", "https://bank.example"),
    ).toBe(false);
    expect(isTrustedOrigin(undefined, "https://bank.example")).toBe(false);
    expect(sessionExpiry(now).toISOString()).toBe("2026-09-04T20:00:00.000Z");
  });
});
