import { describe, expect, it } from "vitest";
import { ChargeBook } from "../src/domain/charge-book.js";

describe("ChargeBook", () => {
  it("cria cobrança agendada", () => {
    const book = new ChargeBook();
    const charge = book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    expect(charge.status).toBe("SCHEDULED");
    expect(charge.id).toBe("charge-1");
  });

  it("lembrete D-2 dispara dois dias antes do vencimento", () => {
    const book = new ChargeBook();
    book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    const reminders = book.pendingReminders("2026-09-08");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].reminderKind).toBe("D_MINUS_2");
  });

  it("lembrete D+1 dispara um dia depois do vencimento", () => {
    const book = new ChargeBook();
    book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    const reminders = book.pendingReminders("2026-09-11");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].reminderKind).toBe("D_PLUS_1");
  });

  it("nada dispara fora das janelas D-2 e D+1", () => {
    const book = new ChargeBook();
    book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    expect(book.pendingReminders("2026-09-09")).toHaveLength(0);
    expect(book.pendingReminders("2026-09-12")).toHaveLength(0);
  });

  it("cobrança paga não gera lembrete nem entra em atraso", () => {
    const book = new ChargeBook();
    const charge = book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    book.markPaid(charge.id);
    expect(book.pendingReminders("2026-09-11")).toHaveLength(0);
    expect(book.overdueCharges("2026-09-15")).toHaveLength(0);
  });

  it("aponta cobrança vencida como atrasada", () => {
    const book = new ChargeBook();
    book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    const overdue = book.overdueCharges("2026-09-15");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].clientName).toBe("Maria Souza");
  });

  it("cancelamento impede lembretes posteriores", () => {
    const book = new ChargeBook();
    const charge = book.create("org-1", "Maria Souza", 15_000, "2026-09-10");
    book.cancel(charge.id);
    expect(book.pendingReminders("2026-09-08")).toHaveLength(0);
  });
});
