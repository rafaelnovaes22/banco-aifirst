import { describe, expect, it } from "vitest";
import { OnboardingGate } from "../src/domain/onboarding-gate.js";

describe("OnboardingGate", () => {
  it("recusa ativação sem KYC aprovado (fail-closed)", () => {
    const gate = new OnboardingGate();
    gate.register("org-1", "12345678000195");
    expect(() => gate.activate("org-1", "2026-09-03T10:00:00Z")).toThrow(
      /expected APPROVED/,
    );
  });

  it("recusa ativação com KYC reprovado", () => {
    const gate = new OnboardingGate();
    gate.register("org-1", "12345678000195");
    gate.applyKycResult("org-1", "REJECTED");
    expect(() => gate.activate("org-1", "2026-09-03T10:00:00Z")).toThrow(
      /REJECTED/,
    );
  });

  it("ativa e opera somente após webhook de aprovação do BaaS", () => {
    const gate = new OnboardingGate();
    gate.register("org-1", "12345678000195");
    expect(gate.isAccountOperational("org-1")).toBe(false);
    gate.applyKycResult("org-1", "APPROVED");
    gate.activate("org-1", "2026-09-03T10:00:00Z");
    expect(gate.isAccountOperational("org-1")).toBe(true);
  });

  it("organização inexistente nunca é operacional", () => {
    const gate = new OnboardingGate();
    expect(gate.isAccountOperational("ghost")).toBe(false);
    expect(() => gate.activate("ghost", "2026-09-03T10:00:00Z")).toThrow(
      /NOT_REGISTERED/,
    );
  });
});
