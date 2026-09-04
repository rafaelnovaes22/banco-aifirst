import { describe, expect, it } from "vitest";
import { buildWeeklySummary } from "../src/domain/weekly-summary.js";

describe("buildWeeklySummary", () => {
  it("monta 5 linhas com números do ledger", () => {
    const summary = buildWeeklySummary({
      orgName: "Studio Débora",
      balanceInCents: 500_000,
      weekInInCents: 200_000,
      weekOutInCents: 80_000,
      overdueClients: [{ clientName: "Maria Souza", amountInCents: 15_000 }],
      lowestProjectedDay: "2026-09-05",
      lowestProjectedBalanceInCents: 350_000,
    });
    const lines = summary.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Studio Débora");
    expect(lines[1]).toContain("R$5000.00");
    expect(lines[2]).toContain("Maria Souza (R$150.00)");
    expect(lines[3]).toContain("2026-09-05");
  });

  it("sem atraso mostra linha positiva em vez de lista vazia", () => {
    const summary = buildWeeklySummary({
      orgName: "Studio",
      balanceInCents: 100_000,
      weekInInCents: 50_000,
      weekOutInCents: 20_000,
      overdueClients: [],
      lowestProjectedDay: "2026-09-08",
      lowestProjectedBalanceInCents: 100_000,
    });
    expect(summary.split("\n")[2]).toContain("nenhuma cobrança em atraso");
  });

  it("limita a 3 inadimplentes para caber no WhatsApp", () => {
    const summary = buildWeeklySummary({
      orgName: "Studio",
      balanceInCents: 100_000,
      weekInInCents: 50_000,
      weekOutInCents: 20_000,
      overdueClients: [
        { clientName: "A", amountInCents: 100 },
        { clientName: "B", amountInCents: 100 },
        { clientName: "C", amountInCents: 100 },
        { clientName: "D", amountInCents: 100 },
      ],
      lowestProjectedDay: "2026-09-08",
      lowestProjectedBalanceInCents: 100_000,
    });
    expect(summary).not.toContain(", D (");
  });
});
