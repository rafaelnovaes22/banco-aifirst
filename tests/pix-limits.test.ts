import { describe, expect, it } from "vitest";
import { decidePixOut } from "../src/domain/pix-limits.js";

const baseRequest = {
  orgId: "org-1",
  amountInCents: 10_000,
  dailyOutflowInCents: 0,
  orgBlocked: false,
} as const;

describe("decidePixOut", () => {
  it("aprova valor baixo dentro do limite diário", () => {
    const decision = decidePixOut({ ...baseRequest });
    expect(decision.kind).toBe("APPROVED");
  });

  it("exige MFA no limiar exato de R$ 500", () => {
    const decision = decidePixOut({ ...baseRequest, amountInCents: 50_000 });
    expect(decision.kind).toBe("NEEDS_MFA");
  });

  it("exige MFA acima do limiar e abaixo do limite diário", () => {
    const decision = decidePixOut({ ...baseRequest, amountInCents: 120_000 });
    expect(decision.kind).toBe("NEEDS_MFA");
  });

  it("manda para humano quando a projeção diária estoura R$ 2000", () => {
    const decision = decidePixOut({
      ...baseRequest,
      amountInCents: 50_000,
      dailyOutflowInCents: 180_000,
    });
    expect(decision.kind).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("aprova na fronteira exata da projeção diária", () => {
    const decision = decidePixOut({
      ...baseRequest,
      amountInCents: 10_000,
      dailyOutflowInCents: 190_000,
    });
    expect(decision.kind).toBe("APPROVED");
  });

  it("bloqueia organização marcada por compliance", () => {
    const decision = decidePixOut({ ...baseRequest, orgBlocked: true });
    expect(decision.kind).toBe("BLOCKED");
    expect(decision.reason).toContain("org-1");
  });

  it("bloqueia valor inválido com contexto do valor recebido", () => {
    const decision = decidePixOut({ ...baseRequest, amountInCents: -5 });
    expect(decision.kind).toBe("BLOCKED");
    expect(decision.reason).toContain("-5");
  });

  it("bloqueia valor não inteiro (fail-closed, sem arredondar dinheiro)", () => {
    const decision = decidePixOut({ ...baseRequest, amountInCents: 10.5 });
    expect(decision.kind).toBe("BLOCKED");
  });
});
