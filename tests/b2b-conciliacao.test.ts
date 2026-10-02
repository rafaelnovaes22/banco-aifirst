import { describe, expect, it } from "vitest";
import { MemoriaExtratoProvider } from "../src/b2b/extrato-provider.js";
import { executarConciliacao } from "../src/b2b/conciliacao.js";

const extrato = [
  {
    id: "m1",
    amountInCents: 150000,
    direction: "IN" as const,
    occurredOn: "2026-09-01",
    descricao: "TED A",
  },
  {
    id: "m2",
    amountInCents: 150000,
    direction: "IN" as const,
    occurredOn: "2026-09-01",
    descricao: "TED B",
  },
  {
    id: "m3",
    amountInCents: 20000,
    direction: "IN" as const,
    occurredOn: "2026-09-03",
    descricao: "Pix C",
  },
];

describe("conciliacao B2B", () => {
  it("separa unica de ambigua e sem match", async () => {
    const provider = new MemoriaExtratoProvider(extrato);
    const { resumo, trilha } = await executarConciliacao(
      provider,
      [
        { amountInCents: 20000, occurredOn: "2026-09-03" },
        { amountInCents: 150000, occurredOn: "2026-09-01" },
        { amountInCents: 999, occurredOn: "2026-09-01" },
      ],
      [],
    );
    expect(resumo.unicas).toBe(1);
    expect(resumo.semMatch).toBe(1);
    expect(resumo.ambiguas).toBe(2);
    expect(trilha).toHaveLength(1);
  });
});
