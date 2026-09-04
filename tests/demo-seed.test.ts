import { describe, expect, it } from "vitest";
import { createAppContext } from "../src/app-context.js";
import { seedDemoContext } from "../src/demo-seed.js";

describe("seedDemoContext", () => {
  it("deixa org-demo operacional com saldo, regra, cobrança e movimento", async () => {
    const context = createAppContext("test-secret");
    await seedDemoContext(context, "2026-09-03T10:00:00Z");
    expect(context.gate.isAccountOperational("org-demo")).toBe(true);
    expect(context.balancesByOrg.get("org-demo")).toBe(500_000);
    expect(context.charges.listByOrg("org-demo")).toHaveLength(1);
    expect(context.ledger.get("seed-1")?.status).toBe("CONFIRMED");
    expect(
      context.consents.hasActiveConsent("org-demo", "OPEN_FINANCE_READ"),
    ).toBe(true);
  });
});
