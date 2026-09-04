// PORQUÊ: a AI nunca resolve caso regulado. Tudo sensível vira ticket com SLA
// por motivo. Estourou o prazo, aparece na lista de breached para escalar.

export type TicketReason =
  | "CONTESTACAO"
  | "LIMITE_PEDIDO"
  | "FRAUDE_SUSPECTED"
  | "DIVERGENT_AMOUNT"
  | "INJECTION_SUSPECTED"
  | "RECEIPT_AMBIGUOUS"
  | "GENERAL";

export const TICKET_SLA_MINUTES: Readonly<Record<TicketReason, number>> = {
  // PORQUÊ: fraude e divergência de valor são os prazos mais curtos. Dinheiro parado com dúvida é risco.
  FRAUDE_SUSPECTED: 60,
  DIVERGENT_AMOUNT: 120,
  INJECTION_SUSPECTED: 120,
  CONTESTACAO: 240,
  RECEIPT_AMBIGUOUS: 240,
  LIMITE_PEDIDO: 480,
  GENERAL: 240,
};

export interface SupportTicket {
  readonly id: string;
  readonly orgId: string;
  readonly reason: TicketReason;
  readonly summary: string;
  readonly createdAtIso: string;
  readonly slaDeadlineIso: string;
  resolvedAtIso?: string;
}

function plusMinutes(iso: string, minutes: number): string {
  // PORQUÊ: trim dos milissegundos para o deadline ficar legível no print do atendente.
  return new Date(Date.parse(iso) + minutes * 60_000)
    .toISOString()
    .replace(".000Z", "Z");
}

export class SupportTicketQueue {
  private readonly tickets: SupportTicket[] = [];
  private sequence = 0;

  open(
    orgId: string,
    reason: TicketReason,
    summary: string,
    nowIso: string,
  ): SupportTicket {
    this.sequence += 1;
    const ticket: SupportTicket = {
      id: `ticket-${this.sequence}`,
      orgId,
      reason,
      summary,
      createdAtIso: nowIso,
      slaDeadlineIso: plusMinutes(nowIso, TICKET_SLA_MINUTES[reason]),
    };
    this.tickets.push(ticket);
    return ticket;
  }

  resolve(ticketId: string, nowIso: string): SupportTicket | undefined {
    const ticket = this.tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket || ticket.resolvedAtIso) return ticket;
    ticket.resolvedAtIso = nowIso;
    return ticket;
  }

  breachedTickets(nowIso: string): readonly SupportTicket[] {
    const now = Date.parse(nowIso);
    return this.tickets.filter(
      (ticket) =>
        !ticket.resolvedAtIso && Date.parse(ticket.slaDeadlineIso) < now,
    );
  }

  openTickets(): readonly SupportTicket[] {
    return this.tickets.filter((ticket) => !ticket.resolvedAtIso);
  }

  allTickets(): readonly SupportTicket[] {
    return [...this.tickets];
  }
}
