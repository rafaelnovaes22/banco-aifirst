import { auditSinkFor, type AppContext } from "./app-context.js";
import { executePixOut } from "./domain/pix-out-executor.js";

// PORQUÊ: o backend é in-memory. SEED_DEMO=true popula a org-demo para
// demonstração ao sócio e para o e2e do painel. Nunca ligar em produção.

export async function seedDemoContext(
  context: AppContext,
  nowIso: string,
): Promise<void> {
  const orgId = "org-demo";
  context.gate.register(orgId, "12345678000195");
  context.gate.applyKycResult(orgId, "APPROVED");
  context.gate.activate(orgId, nowIso);
  context.consents.grant(orgId, "OPEN_FINANCE_READ", nowIso);
  context.balancesByOrg.set(orgId, 500_000);
  context.rulesByOrg.set(orgId, [
    {
      orgId,
      description: "Aluguel do estúdio",
      amountInCents: 150_000,
      direction: "OUT",
      dayOfMonth: 5,
    },
  ]);
  context.charges.create(orgId, "Maria Souza", 15_000, "2026-09-10");
  await executePixOut(
    context.provider,
    context.ledger,
    { idempotencyKey: "seed-1", orgId, amountInCents: 10_000 },
    auditSinkFor(context),
  );
}
