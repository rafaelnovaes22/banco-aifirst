import { describe, expect, it } from "vitest";
import {
  CsvExtratoProvider,
  parseCsvExtrato,
} from "../src/b2b/extrato-provider.js";

describe("extrato B2B", () => {
  it("converte CSV ponto e virgula em movimentos", () => {
    const csv =
      "id;data;descricao;valor;direcao\nm1;2026-09-01;TED cliente A;1.500,00;IN";
    const movimentos = parseCsvExtrato(csv);
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]?.amountInCents).toBe(150000);
  });

  it("ignora linha invalida sem travar", () => {
    const csv =
      "id;data;descricao;valor\nruim;sem-data;x;y\nm2;2026-09-02;Pix B;200,00;OUT";
    const movimentos = parseCsvExtrato(csv);
    expect(movimentos.map((m) => m.id)).toEqual(["m2"]);
  });

  it("provider em memoria lista o que recebeu", async () => {
    const provider = new CsvExtratoProvider("m9;2026-09-03;Tarifa;10,00;OUT");
    const movimentos = await provider.listarMovimentos();
    expect(movimentos[0]?.direction).toBe("OUT");
  });
});
