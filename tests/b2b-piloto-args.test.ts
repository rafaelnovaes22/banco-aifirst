import { describe, expect, it } from "vitest";
import { parsePilotoArgs } from "../src/b2b/piloto-args.js";

describe("args do piloto shadow", () => {
  it("usa premissas padrão com só o CSV", () => {
    const config = parsePilotoArgs(["extrato.csv"]);
    expect(config.extratoPath).toBe("extrato.csv");
    expect(config.comprovantesPath).toBeNull();
    expect(config.nomeOrgao).toBe("Banco Piloto");
    expect(config.premissas.minutosPorMovimentoManual).toBe(6);
    expect(config.premissas.movimentosPorMes).toBe(2000);
  });

  it("lê flags opcionais", () => {
    const config = parsePilotoArgs([
      "extrato.csv",
      "--comprovantes",
      "c.json",
      "--org",
      "Acme",
      "--minutos",
      "10",
      "--custo-hora-centavos",
      "5000",
      "--movimentos-mes",
      "500",
    ]);
    expect(config.comprovantesPath).toBe("c.json");
    expect(config.nomeOrgao).toBe("Acme");
    expect(config.premissas.minutosPorMovimentoManual).toBe(10);
    expect(config.premissas.custoHoraEmCentavos).toBe(5000);
    expect(config.premissas.movimentosPorMes).toBe(500);
  });

  it("falha fechado sem CSV", () => {
    expect(() => parsePilotoArgs([])).toThrow(/extrato ausente/);
    expect(() => parsePilotoArgs(["--org", "X"])).toThrow(/extrato ausente/);
  });

  it("rejeita número inválido com flag e valor recebido", () => {
    expect(() => parsePilotoArgs(["e.csv", "--minutos", "zero"])).toThrow(
      /--minutos.*zero/,
    );
  });

  it("rejeita flag sem valor", () => {
    expect(() => parsePilotoArgs(["e.csv", "--org"])).toThrow(/--org/);
  });
});
