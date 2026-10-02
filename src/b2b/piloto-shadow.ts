// PORQUÊ: piloto shadow prova economia sem tocar em dinheiro.
// Compara tempo manual atual contra tempo assistido e gera número de BCOC.
import { executarConciliacao } from "./conciliacao.js";
import { executarDreContinuo } from "./dre.js";
import type { ExtratoProvider } from "./extrato-provider.js";
import type { ReceiptExtraction } from "../domain/receipt-extraction.js";

export interface ShadowPremissas {
  readonly minutosPorMovimentoManual: number;
  readonly custoHoraEmCentavos: number;
  readonly movimentosPorMes: number;
}

export interface ShadowRelatorio {
  readonly taxaAutoBaixa: number;
  readonly horasEconomizadasMes: number;
  readonly economiaMensalEmCentavos: number;
  readonly textoResumoDre: string;
}

const MINUTOS_POR_HORA = 60;

function taxaAuto(resumo: { unicas: number; totalExtrato: number }): number {
  if (resumo.totalExtrato === 0) return 0;
  return resumo.unicas / resumo.totalExtrato;
}

// PORQUÊ: número conservador vende. Só conta como economia o que baixa
// sem ambiguidade e com trilha. Ambíguo continua humano.
export async function executarPilotoShadow(
  provider: ExtratoProvider,
  extracoes: readonly ReceiptExtraction[],
  premissas: ShadowPremissas,
  nomeOrgao: string,
): Promise<ShadowRelatorio> {
  const { resumo } = await executarConciliacao(provider, extracoes, []);
  const dre = await executarDreContinuo(provider, nomeOrgao);
  const taxa = taxaAuto(resumo);
  const horas =
    (premissas.movimentosPorMes * taxa * premissas.minutosPorMovimentoManual) /
    MINUTOS_POR_HORA;
  const economia = Math.round(horas * premissas.custoHoraEmCentavos);
  return {
    taxaAutoBaixa: taxa,
    horasEconomizadasMes: horas,
    economiaMensalEmCentavos: economia,
    textoResumoDre: dre.textoResumo,
  };
}
