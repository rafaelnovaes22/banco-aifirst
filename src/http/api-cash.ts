import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  projectSevenDayCash,
  type RecurringRule,
} from "../domain/cash-forecast.js";

export interface CashApiDeps {
  readonly rulesByOrg: Map<string, RecurringRule[]>;
  readonly balancesByOrg: Map<string, number>;
}

const cashForecastQuerySchema = z.object({
  orgId: z.string().min(1),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
      message: "startDate inválida",
    }),
});

type CashForecastQuery = z.infer<typeof cashForecastQuerySchema>;

export async function registerCashApi(
  app: FastifyInstance,
  deps: CashApiDeps,
): Promise<void> {
  app.get("/api/cash-forecast", async (request, reply) => {
    const parsed = cashForecastQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "query inválida" });
    return cashForecastReply(app, deps, parsed.data, reply);
  });
}

function cashForecastReply(
  app: FastifyInstance,
  deps: CashApiDeps,
  query: CashForecastQuery,
  reply: FastifyReply,
): unknown {
  const rules = deps.rulesByOrg.get(query.orgId);
  const balance = deps.balancesByOrg.get(query.orgId);
  if (rules === undefined || balance === undefined)
    return reply.code(404).send({ error: `org ${query.orgId} desconhecida` });
  // PORQUÊ: projeção determinística, sem IA no cálculo. O que responde é projectSevenDayCash puro.
  const days = projectSevenDayCash({
    currentBalanceInCents: balance,
    startDateIso: query.startDate,
    rules,
  });
  app.log.info({ orgId: query.orgId }, "cash forecast calculado");
  return { orgId: query.orgId, startDate: query.startDate, days };
}
