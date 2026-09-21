import { describe, expect, it } from "vitest";
import {
  projectSevenDayCash,
  type RecurringRule,
} from "../src/domain/cash-forecast.js";

const rules: readonly RecurringRule[] = [
  {
    orgId: "org-1",
    description: "Aluguel do estúdio",
    amountInCents: 150_000,
    direction: "OUT",
    dayOfMonth: 5,
  },
  {
    orgId: "org-1",
    description: "Assinatura mensal de cliente",
    amountInCents: 200_000,
    direction: "IN",
    dayOfMonth: 6,
  },
];

describe("projectSevenDayCash", () => {
  it("projeta 7 dias a partir da data inicial", () => {
    const days = projectSevenDayCash({
      currentBalanceInCents: 500_000,
      startDateIso: "2026-09-02",
      rules,
    });
    expect(days).toHaveLength(7);
    expect(days[0].dateIso).toBe("2026-09-02");
    expect(days[6].dateIso).toBe("2026-09-08");
  });

  it("desconta saída e soma entrada nos dias de vencimento", () => {
    const days = projectSevenDayCash({
      currentBalanceInCents: 500_000,
      startDateIso: "2026-09-05",
      rules,
    });
    expect(days[0].projectedBalanceInCents).toBe(350_000);
    expect(days[0].appliedDescriptions).toEqual(["Aluguel do estúdio"]);
    expect(days[1].projectedBalanceInCents).toBe(550_000);
    expect(days[1].appliedDescriptions).toEqual([
      "Assinatura mensal de cliente",
    ]);
  });

  it("mantém saldo estável em dia sem recorrência", () => {
    const days = projectSevenDayCash({
      currentBalanceInCents: 100_000,
      startDateIso: "2026-09-10",
      rules,
    });
    expect(days.every((day) => day.projectedBalanceInCents === 100_000)).toBe(
      true,
    );
  });

  it("projeção sem regras devolve o saldo atual em todos os dias", () => {
    const days = projectSevenDayCash({
      currentBalanceInCents: 123_456,
      startDateIso: "2026-09-02",
      rules: [],
    });
    expect(days.every((day) => day.projectedBalanceInCents === 123_456)).toBe(
      true,
    );
  });
});
