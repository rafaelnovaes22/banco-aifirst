// PORQUÊ: conciliação B2B compara comprovante contra extrato do core.
// Regra herdada do motor: valor e data valem, texto nunca decide. Ambíguo sobe.
import type { ReceiptExtraction } from "../domain/receipt-extraction.js";
import {
  classificarLote,
  type TransactionMirror,
} from "../domain/receipt-matcher.js";
import { appendAuditEvent, type AuditEvent } from "../domain/audit-ledger.js";
import type {
  B2bExtratoMovement,
  ExtratoProvider,
} from "./extrato-provider.js";

export interface ConciliacaoResumo {
  readonly totalExtrato: number;
  readonly unicas: number;
  readonly ambiguas: number;
  readonly semMatch: number;
  readonly idsAmbiguos: readonly string[];
}

function paraEspelho(m: B2bExtratoMovement): TransactionMirror {
  return {
    id: m.id,
    amountInCents: m.amountInCents,
    direction: m.direction,
    occurredOn: m.occurredOn,
  };
}

function resumoVazio(total: number): ConciliacaoResumo {
  return {
    totalExtrato: total,
    unicas: 0,
    ambiguas: 0,
    semMatch: 0,
    idsAmbiguos: [],
  };
}

// PORQUÊ: cada baixa única gera evento auditável. Auditoria é o que risco
// e compliance pedem primeiro, antes de qualquer promessa de IA.
export async function executarConciliacao(
  provider: ExtratoProvider,
  extracoes: readonly ReceiptExtraction[],
  trilha: readonly AuditEvent[],
): Promise<{ resumo: ConciliacaoResumo; trilha: readonly AuditEvent[] }> {
  const movimentos = await provider.listarMovimentos();
  const espelhos = movimentos.map(paraEspelho);
  if (extracoes.length === 0)
    return { resumo: resumoVazio(movimentos.length), trilha };
  return conciliarLote(espelhos, extracoes, movimentos.length, trilha);
}

function conciliarLote(
  espelhos: readonly TransactionMirror[],
  extracoes: readonly ReceiptExtraction[],
  total: number,
  trilha: readonly AuditEvent[],
): { resumo: ConciliacaoResumo; trilha: readonly AuditEvent[] } {
  const lote = classificarLote(extracoes, espelhos);
  let cadeia: readonly AuditEvent[] = trilha;
  for (const baixa of lote.baixasUnicas) {
    cadeia = [
      ...cadeia,
      appendAuditEvent(cadeia, {
        actorId: "b2b-conciliacao",
        action: "baixa_conciliada",
        objectId: baixa.transactionId,
        channel: "SYSTEM",
        payloadJson: JSON.stringify({ valor: baixa.amountInCents }),
      }),
    ];
  }
  return {
    resumo: {
      totalExtrato: total,
      unicas: lote.unicas,
      ambiguas: lote.idsAmbiguos.length,
      semMatch: lote.semMatch,
      idsAmbiguos: lote.idsAmbiguos,
    },
    trilha: cadeia,
  };
}
