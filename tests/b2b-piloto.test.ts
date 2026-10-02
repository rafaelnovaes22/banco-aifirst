import { describe, expect, it } from "vitest";
import { MemoriaExtratoProvider } from "../src/b2b/extrato-provider.js";
import { executarPilotoShadow } from "../src/b2b/piloto-shadow.js";

describe("piloto shadow B2B", () => {
  it("calcula economia a partir de baixa automatica", async () => {
    const provider = new MemoriaExtratoProvider([
      {
        id: "m1",
        amountInCents: 10000,
        direction: "IN",
        occurredOn: "2026-09-01",
        descricao: "pix cliente",
      },
      {
        id: "m2",
        amountInCents: 5000,
        direction: "OUT",
        occurredOn: "2026-09-02",
        descricao: "tarifa",
      },
    ]);
    const rel = await executarPilotoShadow(
      provider,
      [{ amountInCents: 10000, occurredOn: "2026-09-01" }],
      {
        minutosPorMovimentoManual: 6,
        custoHoraEmCentavos: 8000,
        movimentosPorMes: 2000,
      },
      "Banco Piloto",
    );
    expect(rel.taxaAutoBaixa).toBe(0.5);
    expect(rel.economiaMensalEmCentavos).toBeGreaterThan(0);
  });
});
