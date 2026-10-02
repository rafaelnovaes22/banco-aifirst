// PORQUÊ: DRE contínua nasce da classificação confirmada por humano.
// IA sugere, humano confirma. Nenhum ator ai- confirma, regra do motor.
import { suggestCategory } from "../domain/transaction-categorizer.js";
import { buildWeeklySummary } from "../domain/weekly-summary.js";
import type { ExtratoProvider } from "./extrato-provider.js";

export interface DreLinha {
  readonly categoria: string;
  readonly entradasEmCentavos: number;
  readonly saidasEmCentavos: number;
}

export interface DreResumo {
  readonly totalInEmCentavos: number;
  readonly totalOutEmCentavos: number;
  readonly saldoEmCentavos: number;
  readonly linhas: readonly DreLinha[];
  readonly textoResumo: string;
}

function linhaVazia(categoria: string): DreLinha {
  return { categoria, entradasEmCentavos: 0, saidasEmCentavos: 0 };
}

interface DreItem {
  readonly categoria: string;
  readonly direction: "IN" | "OUT";
  readonly valor: number;
}

function agrupar(itens: readonly DreItem[]): DreLinha[] {
  const mapa = new Map<string, DreLinha>();
  for (const item of itens) {
    const atual = mapa.get(item.categoria) ?? linhaVazia(item.categoria);
    const proxima: DreLinha =
      item.direction === "IN"
        ? {
            ...atual,
            categoria: atual.categoria,
            entradasEmCentavos: atual.entradasEmCentavos + item.valor,
          }
        : {
            ...atual,
            categoria: atual.categoria,
            saidasEmCentavos: atual.saidasEmCentavos + item.valor,
          };
    mapa.set(item.categoria, proxima);
  }
  return [...mapa.values()];
}

// PORQUÊ: texto do resumo usa só número do ledger, nunca texto gerado.
// Formato fixo de 5 linhas, pronto para WhatsApp do gerente.
export async function executarDreContinuo(
  provider: ExtratoProvider,
  nomeOrgao: string,
): Promise<DreResumo> {
  const movimentos = await provider.listarMovimentos();
  const itens = movimentos.map((m) => ({
    categoria: suggestCategory(m.descricao).category,
    direction: m.direction,
    valor: m.amountInCents,
  }));
  let totalIn = 0;
  let totalOut = 0;
  for (const item of itens) {
    if (item.direction === "IN") totalIn += item.valor;
    else totalOut += item.valor;
  }
  const linhas = agrupar(itens);
  const textoResumo = buildWeeklySummary({
    orgName: nomeOrgao,
    balanceInCents: totalIn - totalOut,
    weekInInCents: totalIn,
    weekOutInCents: totalOut,
    overdueClients: [],
    lowestProjectedDay: "hoje",
    lowestProjectedBalanceInCents: totalIn - totalOut,
  });
  return {
    totalInEmCentavos: totalIn,
    totalOutEmCentavos: totalOut,
    saldoEmCentavos: totalIn - totalOut,
    linhas,
    textoResumo,
  };
}
