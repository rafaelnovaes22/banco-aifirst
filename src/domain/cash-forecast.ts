// PORQUÊ: o alerta que vende o produto é "seu saldo daqui 7 dias". Projeção
// determinística a partir de recorrências confirmadas, sem IA no cálculo.

export interface RecurringRule {
  readonly orgId: string;
  readonly description: string;
  readonly amountInCents: number;
  readonly direction: "IN" | "OUT";
  readonly dayOfMonth: number;
}

export interface CashProjectionDay {
  readonly dateIso: string;
  readonly projectedBalanceInCents: number;
  readonly appliedDescriptions: readonly string[];
}

export interface CashProjectionInput {
  readonly currentBalanceInCents: number;
  readonly startDateIso: string;
  readonly rules: readonly RecurringRule[];
}

const DAY_IN_MS = 86_400_000;

function dateAtMidnightUtc(startEpochMs: number, dayOffset: number): Date {
  return new Date(startEpochMs + dayOffset * DAY_IN_MS);
}

export function projectSevenDayCash(
  input: CashProjectionInput,
): readonly CashProjectionDay[] {
  const startEpochMs = Date.parse(`${input.startDateIso}T00:00:00Z`);
  let balance = input.currentBalanceInCents;
  const days: CashProjectionDay[] = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const day = dateAtMidnightUtc(startEpochMs, dayOffset);
    const dueToday = input.rules.filter(
      (rule) => rule.dayOfMonth === day.getUTCDate(),
    );
    const appliedDescriptions: string[] = [];
    for (const rule of dueToday) {
      balance +=
        rule.direction === "IN" ? rule.amountInCents : -rule.amountInCents;
      appliedDescriptions.push(rule.description);
    }
    days.push({
      dateIso: day.toISOString().slice(0, 10),
      projectedBalanceInCents: balance,
      appliedDescriptions,
    });
  }
  return days;
}
