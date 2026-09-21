import { describe, expect, it } from "vitest";
import { ConsentLedger } from "../src/domain/consent-ledger.js";

const NOW = "2026-09-03T10:00:00Z";

describe("ConsentLedger", () => {
  it("bloqueia leitura de dado sem consentimento para a finalidade", () => {
    const ledger = new ConsentLedger();
    expect(() => ledger.requireConsent("org-1", "OPEN_FINANCE_READ")).toThrow(
      /no active consent/,
    );
  });

  it("concessão libera o acesso para aquela finalidade específica", () => {
    const ledger = new ConsentLedger();
    ledger.grant("org-1", "OPEN_FINANCE_READ", NOW);
    expect(() =>
      ledger.requireConsent("org-1", "OPEN_FINANCE_READ"),
    ).not.toThrow();
    expect(() => ledger.requireConsent("org-1", "MARKETING")).toThrow();
  });

  it("revogação bloqueia o acesso imediatamente", () => {
    const ledger = new ConsentLedger();
    ledger.grant("org-1", "MARKETING", NOW);
    ledger.revoke("org-1", "MARKETING", "2026-09-04T09:00:00Z");
    expect(ledger.hasActiveConsent("org-1", "MARKETING")).toBe(false);
  });

  it("reconcessão após revogação reativa o consentimento", () => {
    const ledger = new ConsentLedger();
    ledger.grant("org-1", "MARKETING", NOW);
    ledger.revoke("org-1", "MARKETING", "2026-09-04T09:00:00Z");
    ledger.grant("org-1", "MARKETING", "2026-09-10T09:00:00Z");
    expect(ledger.hasActiveConsent("org-1", "MARKETING")).toBe(true);
  });

  it("revogação dupla não sobrescreve a data original", () => {
    const ledger = new ConsentLedger();
    ledger.grant("org-1", "MARKETING", NOW);
    const revoked = ledger.revoke("org-1", "MARKETING", "2026-09-04T09:00:00Z");
    ledger.revoke("org-1", "MARKETING", "2026-09-20T09:00:00Z");
    expect(revoked?.revokedAtIso).toBe("2026-09-04T09:00:00Z");
  });
});
