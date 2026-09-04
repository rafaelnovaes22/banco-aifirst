import { describe, expect, it } from "vitest";
import {
  SupportTicketQueue,
  TICKET_SLA_MINUTES,
} from "../src/domain/support-ticket-queue.js";

describe("SupportTicketQueue", () => {
  it("abre ticket com deadline de SLA conforme o motivo", () => {
    const queue = new SupportTicketQueue();
    const ticket = queue.open(
      "org-1",
      "FRAUDE_SUSPECTED",
      "padrão estranho em 3 pix seguidos",
      "2026-09-03T10:00:00Z",
    );
    expect(ticket.slaDeadlineIso).toBe("2026-09-03T11:00:00Z");
  });

  it("motivo de limite tem SLA mais folgado que fraude", () => {
    expect(TICKET_SLA_MINUTES.LIMITE_PEDIDO).toBeGreaterThan(
      TICKET_SLA_MINUTES.FRAUDE_SUSPECTED,
    );
  });

  it("resolve ticket e ele sai da lista de abertos", () => {
    const queue = new SupportTicketQueue();
    const ticket = queue.open(
      "org-1",
      "CONTESTACAO",
      "cliente discorda da tarifa",
      "2026-09-03T10:00:00Z",
    );
    queue.resolve(ticket.id, "2026-09-03T11:30:00Z");
    expect(queue.openTickets()).toHaveLength(0);
  });

  it("aponta ticket estourado de SLA como breached", () => {
    const queue = new SupportTicketQueue();
    queue.open("org-1", "FRAUDE_SUSPECTED", "suspeita", "2026-09-03T10:00:00Z");
    const breached = queue.breachedTickets("2026-09-03T11:00:01Z");
    expect(breached).toHaveLength(1);
    expect(breached[0].reason).toBe("FRAUDE_SUSPECTED");
  });

  it("ticket dentro do prazo não é breached", () => {
    const queue = new SupportTicketQueue();
    queue.open("org-1", "FRAUDE_SUSPECTED", "suspeita", "2026-09-03T10:00:00Z");
    expect(queue.breachedTickets("2026-09-03T10:59:00Z")).toHaveLength(0);
  });

  it("allTickets expõe abertos e resolvidos (painel enxerga o histórico)", () => {
    const queue = new SupportTicketQueue();
    const first = queue.open(
      "org-1",
      "GENERAL",
      "dúvida simples",
      "2026-09-03T10:00:00Z",
    );
    queue.open("org-1", "CONTESTACAO", "contestação", "2026-09-03T10:05:00Z");
    queue.resolve(first.id, "2026-09-03T10:30:00Z");
    expect(queue.allTickets()).toHaveLength(2);
    expect(queue.openTickets()).toHaveLength(1);
  });

  it("resolver duas vezes não reabre nem duplica", () => {
    const queue = new SupportTicketQueue();
    const ticket = queue.open(
      "org-1",
      "GENERAL",
      "dúvida simples",
      "2026-09-03T10:00:00Z",
    );
    const first = queue.resolve(ticket.id, "2026-09-03T10:30:00Z");
    const second = queue.resolve(ticket.id, "2026-09-03T12:00:00Z");
    expect(second?.resolvedAtIso).toBe(first?.resolvedAtIso);
  });
});
