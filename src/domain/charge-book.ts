// PORQUÊ: cobrança esquecida é o maior vazamento de caixa do autônomo.
// Lembretes determinísticos: D-2 antes do vencimento e D+1 depois.

export type ChargeStatus = "SCHEDULED" | "PAID" | "CANCELED";

export interface Charge {
  readonly id: string;
  readonly orgId: string;
  readonly clientName: string;
  readonly amountInCents: number;
  readonly dueDateIso: string;
  status: ChargeStatus;
}

export type ReminderKind = "D_MINUS_2" | "D_PLUS_1";

export interface ChargeReminder {
  readonly charge: Charge;
  readonly reminderKind: ReminderKind;
}

function dayNumber(dateIso: string): number {
  return Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000);
}

export class ChargeBook {
  private readonly charges: Charge[] = [];
  private sequence = 0;

  create(
    orgId: string,
    clientName: string,
    amountInCents: number,
    dueDateIso: string,
  ): Charge {
    this.sequence += 1;
    const charge: Charge = {
      id: `charge-${this.sequence}`,
      orgId,
      clientName,
      amountInCents,
      dueDateIso,
      status: "SCHEDULED",
    };
    this.charges.push(charge);
    return charge;
  }

  markPaid(chargeId: string): Charge | undefined {
    const charge = this.charges.find((candidate) => candidate.id === chargeId);
    if (charge && charge.status === "SCHEDULED") charge.status = "PAID";
    return charge;
  }

  cancel(chargeId: string): Charge | undefined {
    const charge = this.charges.find((candidate) => candidate.id === chargeId);
    if (charge && charge.status === "SCHEDULED") charge.status = "CANCELED";
    return charge;
  }

  listByOrg(orgId: string): readonly Charge[] {
    return this.charges.filter((charge) => charge.orgId === orgId);
  }

  pendingReminders(todayIso: string): readonly ChargeReminder[] {
    const today = dayNumber(todayIso);
    return this.charges
      .filter((charge) => charge.status === "SCHEDULED")
      .map((charge) => ({
        charge,
        daysUntilDue: dayNumber(charge.dueDateIso) - today,
      }))
      .filter(({ daysUntilDue }) => daysUntilDue === 2 || daysUntilDue === -1)
      .map(({ charge, daysUntilDue }) => ({
        charge,
        reminderKind:
          daysUntilDue === 2 ? ("D_MINUS_2" as const) : ("D_PLUS_1" as const),
      }));
  }

  overdueCharges(todayIso: string): readonly Charge[] {
    const today = dayNumber(todayIso);
    return this.charges.filter(
      (charge) =>
        charge.status === "SCHEDULED" && dayNumber(charge.dueDateIso) < today,
    );
  }
}
