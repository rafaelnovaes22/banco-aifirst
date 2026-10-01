import { describe, expect, it } from "vitest";
import { MemoriaExtratoProvider } from "../src/b2b/extrato-provider.js";
import { executarDreContinuo } from "../src/b2b/dre.js";

describe("DRE continua B2B", () => {
  it("soma entradas e saidas e gera texto", async () => {
    const provider = new MemoriaExtratoProvider([
      {
        id: "a",
        amountInCents: 100000,
        direction: "IN",
        occurredOn: "2026-09-01",
        descricao: "aluguel recebido",
      },
      {
        id: "b",
        amountInCents: 20000,
        direction: "OUT",
        occurredOn: "2026-09-02",
        descricao: "tarifa banco",
      },
    ]);
    const dre = await executarDreContinuo(provider, "Banco Piloto");
    expect(dre.totalInEmCentavos).toBe(100000);
    expect(dre.saldoEmCentavos).toBe(80000);
    expect(dre.textoResumo).toContain("Banco Piloto");
  });
});
