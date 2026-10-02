// PORQUÊ: o shadow do navegador decide com a mesma regra do Node. Estes casos
// travam taxa, economia e rejeição de entrada fora do contrato.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executarShadowNavegador,
  type ShadowNavegadorEntrada,
} from "./b2b-shadow.ts";

const CSV_DEMO = [
  "id;data;descricao;valor;direcao",
  "m1;2026-09-01;TED cliente Alfa;1.500,00;IN",
  "m2;2026-09-02;Pix cliente Beta;200,00;IN",
  "m3;2026-09-03;Tarifa manutencao;10,00;OUT",
  "m4;2026-09-04;TED fornecedor Gama;800,00;OUT",
].join("\n");

const COMPROVANTES_DEMO = [
  { amountInCents: 150000, occurredOn: "2026-09-01" },
  { amountInCents: 20000, occurredOn: "2026-09-02" },
];

function entrada(
  parcial: Partial<ShadowNavegadorEntrada> = {},
): ShadowNavegadorEntrada {
  return { csv: CSV_DEMO, comprovantes: COMPROVANTES_DEMO, ...parcial };
}

test("baixa única vira taxa e economia", () => {
  const relatorio = executarShadowNavegador(entrada());
  assert.equal(relatorio.totalExtrato, 4);
  assert.equal(relatorio.unicas, 2);
  assert.equal(relatorio.taxaAutoBaixa, 0.5);
  assert.ok(relatorio.horasEconomizadasMes > 0);
  assert.ok(relatorio.economiaMensalEmCentavos > 0);
  assert.ok(relatorio.textoResumoDre.includes("Banco Piloto"));
});

test("sem comprovantes a taxa zera e o DRE continua válido", () => {
  const relatorio = executarShadowNavegador(entrada({ comprovantes: [] }));
  assert.equal(relatorio.taxaAutoBaixa, 0);
  assert.equal(relatorio.economiaMensalEmCentavos, 0);
  assert.ok(relatorio.textoResumoDre.length > 0);
  assert.ok(relatorio.linhasDre.length > 0);
});

test("csv vazio falha com 422", () => {
  assert.throws(
    () => executarShadowNavegador(entrada({ csv: "   " })),
    (error) => {
      assert.equal((error as { status?: number }).status, 422);
      return true;
    },
  );
});

test("comprovante fora do contrato falha com índice", () => {
  assert.throws(
    () =>
      executarShadowNavegador(
        entrada({ comprovantes: [{ amountInCents: -5, occurredOn: "x" }] }),
      ),
    (error) => {
      const message = (error as Error).message;
      assert.match(message, /Comprovante 0/);
      return true;
    },
  );
});

test("campo desconhecido falha com 422", () => {
  assert.throws(
    () =>
      executarShadowNavegador({
        csv: CSV_DEMO,
        // @ts-expect-error contrato: campo fora da lista
        origem: "core",
      }),
    (error) => {
      assert.equal((error as { status?: number }).status, 422);
      return true;
    },
  );
});
