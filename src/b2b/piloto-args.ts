// PORQUÊ: a borda do CLI é argv puro. Zod valida aqui, o núcleo B2B
// recebe número já tipado e nunca precisa conhecer flag.
import { z } from "zod";
import type { ShadowPremissas } from "./piloto-shadow.js";

export interface PilotoCliConfig {
  readonly extratoPath: string;
  readonly comprovantesPath: string | null;
  readonly nomeOrgao: string;
  readonly premissas: ShadowPremissas;
}

const premissasSchema = z.object({
  minutosPorMovimentoManual: z.number().positive().max(120),
  custoHoraEmCentavos: z.number().int().positive(),
  movimentosPorMes: z.number().int().positive(),
});

const DEFAULT_PREMMISSAS: ShadowPremissas = {
  minutosPorMovimentoManual: 6,
  custoHoraEmCentavos: 8000,
  movimentosPorMes: 2000,
};

function readFlag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(
      `flag ${name} recebida sem valor, esperado texto após ${name}`,
    );
  return value;
}

function parsePositiveNumber(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(
      `flag ${flag} inválida: recebido "${raw}", esperado número positivo`,
    );
  return value;
}

function parsePremissas(args: readonly string[]): ShadowPremissas {
  const minutosRaw = readFlag(args, "--minutos");
  const custoRaw = readFlag(args, "--custo-hora-centavos");
  const volumeRaw = readFlag(args, "--movimentos-mes");
  const candidato = {
    minutosPorMovimentoManual:
      minutosRaw === null
        ? DEFAULT_PREMMISSAS.minutosPorMovimentoManual
        : parsePositiveNumber(minutosRaw, "--minutos"),
    custoHoraEmCentavos:
      custoRaw === null
        ? DEFAULT_PREMMISSAS.custoHoraEmCentavos
        : parsePositiveNumber(custoRaw, "--custo-hora-centavos"),
    movimentosPorMes:
      volumeRaw === null
        ? DEFAULT_PREMMISSAS.movimentosPorMes
        : parsePositiveNumber(volumeRaw, "--movimentos-mes"),
  };
  const parsed = premissasSchema.safeParse(candidato);
  if (!parsed.success)
    throw new Error(`premissas rejeitadas: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

// PORQUÊ: argv[0] é o CSV do extrato, resto é flag opcional. Sem CSV
// não há o que conciliar, então falha fechado com uso esperado.
export function parsePilotoArgs(args: readonly string[]): PilotoCliConfig {
  const extratoPath = args[0];
  if (extratoPath === undefined || extratoPath.startsWith("--"))
    throw new Error(
      "extrato ausente: uso esperado `piloto:shadow <extrato.csv> [--comprovantes c.json] [--org Nome] [--minutos 6] [--custo-hora-centavos 8000] [--movimentos-mes 2000]`",
    );
  const comprovantesPath = readFlag(args, "--comprovantes");
  const orgFlag = readFlag(args, "--org");
  return {
    extratoPath,
    comprovantesPath,
    nomeOrgao: orgFlag ?? "Banco Piloto",
    premissas: parsePremissas(args),
  };
}
