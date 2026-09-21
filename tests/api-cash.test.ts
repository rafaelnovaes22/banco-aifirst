import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { RecurringRule } from "../src/domain/cash-forecast.js";
import { registerCashApi } from "../src/http/api-cash.js";

const rules: RecurringRule[] = [
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

describe("GET /api/cash-forecast", () => {
  it("responde a projeção de 7 dias", async () => {
    const app = Fastify();
    await registerCashApi(app, {
      rulesByOrg: new Map([["org-1", rules]]),
      balancesByOrg: new Map([["org-1", 500_000]]),
    });
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/cash-forecast?orgId=org-1&startDate=2026-09-05",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.days).toHaveLength(7);
    expect(body.days[0].dateIso).toBe("2026-09-05");
    expect(body.days[0].projectedBalanceInCents).toBe(350_000);
    expect(body.days[1].projectedBalanceInCents).toBe(550_000);
    expect(body.days[6].dateIso).toBe("2026-09-11");
  });

  it("org desconhecida retorna 404", async () => {
    const app = Fastify();
    await registerCashApi(app, {
      rulesByOrg: new Map([["org-1", rules]]),
      balancesByOrg: new Map([["org-1", 500_000]]),
    });
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/cash-forecast?orgId=org-9&startDate=2026-09-05",
    });
    expect(response.statusCode).toBe(404);
  });

  it("startDate fora do formato retorna 400", async () => {
    const app = Fastify();
    await registerCashApi(app, {
      rulesByOrg: new Map([["org-1", rules]]),
      balancesByOrg: new Map([["org-1", 500_000]]),
    });
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/cash-forecast?orgId=org-1&startDate=05-09-2026",
    });
    expect(response.statusCode).toBe(400);
  });
});
