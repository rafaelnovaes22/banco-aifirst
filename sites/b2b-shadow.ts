// PORQUÊ: espelho navegador do piloto shadow. O sites/ espelha o Node porque
// o bundle do Pages não tem node:crypto (cadeia do audit-ledger) e os testes
// do sites rodam em node --test sem remapear .js para .ts. Regra canônica em
// src/b2b/conciliacao.ts, src/b2b/dre.ts e src/b2b/piloto-shadow.ts: valor e
// data decidem, ambíguo sobe para humano, trilha vai para o pages-store.
import { parseCsvExtrato } from "../src/b2b/extrato-provider.ts";
import {
  classificarLote,
  type TransactionMirror,
} from "../src/domain/receipt-matcher.ts";
import { suggestCategory } from "../src/domain/transaction-categorizer.ts";
import { buildWeeklySummary } from "../src/domain/weekly-summary.ts";
import type { ReceiptExtraction } from "../src/domain/receipt-extraction.ts";
import { exactFields, HttpError } from "./validation.ts";

export interface ShadowNavegadorPremissas {
  readonly minutosPorMovimentoManual: number;
  readonly custoHoraEmCentavos: number;
  readonly movimentosPorMes: number;
}

export interface DreLinhaNavegador {
  readonly categoria: string;
  readonly entradasEmCentavos: number;
  readonly saidasEmCentavos: number;
}

export interface RelatorioShadowNavegador {
  readonly totalExtrato: number;
  readonly unicas: number;
  readonly ambiguas: number;
  readonly semMatch: number;
  readonly idsAmbiguos: readonly string[];
  readonly linhasDre: readonly DreLinhaNavegador[];
  readonly taxaAutoBaixa: number;
  readonly horasEconomizadasMes: number;
  readonly economiaMensalEmCentavos: number;
  readonly textoResumoDre: string;
}

export interface ShadowNavegadorEntrada {
  readonly csv: unknown;
  readonly comprovantes?: unknown;
  readonly premissas?: unknown;
  readonly org?: unknown;
}

const CSV_MAX_CHARS = 20_000;
const MOVIMENTOS_MAX = 2_000;
const COMPROVANTES_MAX = 2_000;
const DATA_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTOS_POR_HORA = 60;

const PREMISSAS_PADRAO: ShadowNavegadorPremissas = {
  minutosPorMovimentoManual: 6,
  custoHoraEmCentavos: 8000,
  movimentosPorMes: 2000,
};

function parseCsvEntrada(csv: unknown): string {
  if (typeof csv !== "string" || csv.trim().length === 0)
    throw new HttpError(422, "Campo csv inválido: esperado texto do extrato.");
  if (csv.length > CSV_MAX_CHARS)
    throw new HttpError(
      422,
      `Extrato grande demais: recebido ${csv.length} caracteres, máximo ${CSV_MAX_CHARS}.`,
    );
  return csv;
}

function parseComprovante(item: unknown, indice: number): ReceiptExtraction {
  const valor = (item as { amountInCents?: unknown })?.amountInCents;
  const data = (item as { occurredOn?: unknown })?.occurredOn;
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor <= 0)
    throw new HttpError(
      422,
      `Comprovante ${indice} inválido: esperado amountInCents inteiro positivo.`,
    );
  if (typeof data !== "string" || !DATA_PATTERN.test(data))
    throw new HttpError(
      422,
      `Comprovante ${indice} inválido: esperado occurredOn AAAA-MM-DD.`,
    );
  return { amountInCents: valor, occurredOn: data };
}

function parseComprovantes(raw: unknown): readonly ReceiptExtraction[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > COMPROVANTES_MAX)
    throw new HttpError(
      422,
      "Campo comprovantes inválido: esperado array JSON.",
    );
  return raw.map((item, indice) => parseComprovante(item, indice));
}

function parseNumeroPositivo(
  valor: unknown,
  campo: string,
  padrao: number,
): number {
  if (valor === undefined) return padrao;
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0)
    throw new HttpError(
      422,
      `Premissa ${campo} inválida: esperado número positivo.`,
    );
  return valor;
}

function parsePremissas(raw: unknown): ShadowNavegadorPremissas {
  if (raw === undefined) return PREMISSAS_PADRAO;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new HttpError(422, "Campo premissas inválido: esperado objeto.");
  const objeto = raw as Record<string, unknown>;
  return {
    minutosPorMovimentoManual: parseNumeroPositivo(
      objeto["minutosPorMovimentoManual"],
      "minutosPorMovimentoManual",
      PREMISSAS_PADRAO.minutosPorMovimentoManual,
    ),
    custoHoraEmCentavos: parseNumeroPositivo(
      objeto["custoHoraEmCentavos"],
      "custoHoraEmCentavos",
      PREMISSAS_PADRAO.custoHoraEmCentavos,
    ),
    movimentosPorMes: parseNumeroPositivo(
      objeto["movimentosPorMes"],
      "movimentosPorMes",
      PREMISSAS_PADRAO.movimentosPorMes,
    ),
  };
}

function parseOrgao(raw: unknown): string {
  if (raw === undefined) return "Banco Piloto";
  if (
    typeof raw !== "string" ||
    raw.trim().length === 0 ||
    raw.trim().length > 80
  )
    throw new HttpError(
      422,
      "Campo org inválido: esperado nome com até 80 letras.",
    );
  return raw.trim();
}

// PORQUÊ: mesmo agrupamento do executarDreContinuo: IA sugere por regra,
// humano confirma fora daqui. O texto usa só número do resumo, nunca gerado.
function dreNavegador(
  movimentos: readonly {
    descricao: string;
    direction: "IN" | "OUT";
    amountInCents: number;
  }[],
  nomeOrgao: string,
): { linhas: DreLinhaNavegador[]; textoResumo: string } {
  const linhas = new Map<string, DreLinhaNavegador>();
  let entradas = 0;
  let saidas = 0;
  for (const movimento of movimentos) {
    const categoria = suggestCategory(movimento.descricao).category;
    const atual = linhas.get(categoria) ?? {
      categoria,
      entradasEmCentavos: 0,
      saidasEmCentavos: 0,
    };
    if (movimento.direction === "IN") entradas += movimento.amountInCents;
    else saidas += movimento.amountInCents;
    linhas.set(categoria, {
      categoria,
      entradasEmCentavos:
        atual.entradasEmCentavos +
        (movimento.direction === "IN" ? movimento.amountInCents : 0),
      saidasEmCentavos:
        atual.saidasEmCentavos +
        (movimento.direction === "OUT" ? movimento.amountInCents : 0),
    });
  }
  const textoResumo = buildWeeklySummary({
    orgName: nomeOrgao,
    balanceInCents: entradas - saidas,
    weekInInCents: entradas,
    weekOutInCents: saidas,
    overdueClients: [],
    lowestProjectedDay: "hoje",
    lowestProjectedBalanceInCents: entradas - saidas,
  });
  return { linhas: [...linhas.values()], textoResumo };
}

// PORQUÊ: mesma conta do executarPilotoShadow em leitura: só baixa única sem
// ambiguidade vira economia. Ambíguo continua humano, sem tocar em dinheiro.
export function executarShadowNavegador(
  entrada: ShadowNavegadorEntrada,
): RelatorioShadowNavegador {
  exactFields(
    entrada as unknown as Record<string, unknown>,
    ["csv", "comprovantes", "premissas", "org"],
    ["csv"],
  );
  const csv = parseCsvEntrada(entrada.csv);
  const extracoes = parseComprovantes(entrada.comprovantes);
  const premissas = parsePremissas(entrada.premissas);
  const nomeOrgao = parseOrgao(entrada.org);
  const movimentos = parseCsvExtrato(csv);
  if (movimentos.length === 0 || movimentos.length > MOVIMENTOS_MAX)
    throw new HttpError(
      422,
      `Extrato sem movimento válido: recebidos ${movimentos.length}, esperado entre 1 e ${MOVIMENTOS_MAX}.`,
    );
  const espelhos: TransactionMirror[] = movimentos.map((movimento) => ({
    id: movimento.id,
    amountInCents: movimento.amountInCents,
    direction: movimento.direction,
    occurredOn: movimento.occurredOn,
  }));
  const lote = classificarLote(extracoes, espelhos);
  const dre = dreNavegador(movimentos, nomeOrgao);
  const taxa = lote.unicas / movimentos.length;
  const horas =
    (premissas.movimentosPorMes * taxa * premissas.minutosPorMovimentoManual) /
    MINUTOS_POR_HORA;
  return {
    totalExtrato: movimentos.length,
    unicas: lote.unicas,
    ambiguas: lote.idsAmbiguos.length,
    semMatch: lote.semMatch,
    idsAmbiguos: lote.idsAmbiguos,
    linhasDre: dre.linhas,
    taxaAutoBaixa: taxa,
    horasEconomizadasMes: horas,
    economiaMensalEmCentavos: Math.round(horas * premissas.custoHoraEmCentavos),
    textoResumoDre: dre.textoResumo,
  };
}
