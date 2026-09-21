// PORQUÊ: alçada e maker-checker do GeraBoleto, com vocabulário do banco. Bloqueio
// acontece na decisão, nunca na preparação, para o humano ver o motivo.
export interface PaymentDecision {
  allowed: boolean;
  reasons: string[];
  policy_version: string;
  real_execution: false;
}

export const POLICY_VERSION = "fluxo-payments-v1";
export const PAYMENT_AUTHORITY_LIMIT_CENTS = 500_000;

interface PaymentFacts {
  amountInCents: number;
  recipientVerified: boolean;
  creatorId: string;
  approverId: string;
  balanceInCents: number;
}

export function evaluateApprovalPayment(facts: PaymentFacts): PaymentDecision {
  const reasons: string[] = [];
  if (!facts.creatorId || !facts.approverId) {
    reasons.push("Criador e aprovador precisam estar identificados.");
  }
  if (facts.creatorId && facts.creatorId === facts.approverId) {
    reasons.push("Aprovação exige uma pessoa diferente do criador.");
  }
  if (!facts.recipientVerified) {
    reasons.push("O favorecido precisa estar verificado.");
  }
  if (!Number.isSafeInteger(facts.amountInCents) || facts.amountInCents <= 0) {
    reasons.push("O valor precisa ser positivo em centavos.");
  }
  if (facts.amountInCents > PAYMENT_AUTHORITY_LIMIT_CENTS) {
    reasons.push("O valor excede a alçada de R$ 5.000,00 do sandbox.");
  }
  if (facts.balanceInCents < facts.amountInCents) {
    reasons.push("O saldo demonstrativo não cobre a operação.");
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    policy_version: POLICY_VERSION,
    real_execution: false,
  };
}
