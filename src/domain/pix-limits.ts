// PORQUÊ: dinheiro só se move por decisão determinística. A AI nunca executa,
// nunca sugere limite e não tem credencial do BaaS. Toda dúvida vira humano (fail-closed).

export const PIX_LIMITS = {
  mfaThresholdInCents: 50_000,
  dailyHumanReviewInCents: 200_000,
} as const;

export type MoneyMovementDecisionKind =
  "APPROVED" | "NEEDS_MFA" | "NEEDS_HUMAN_REVIEW" | "BLOCKED";

export interface MoneyMovementRequest {
  readonly orgId: string;
  readonly amountInCents: number;
  readonly dailyOutflowInCents: number;
  readonly orgBlocked: boolean;
}

export interface MoneyMovementDecision {
  readonly kind: MoneyMovementDecisionKind;
  readonly reason: string;
}

export function decidePixOut(
  request: MoneyMovementRequest,
  limits: typeof PIX_LIMITS = PIX_LIMITS,
): MoneyMovementDecision {
  if (request.orgBlocked) {
    return {
      kind: "BLOCKED",
      reason: `org ${request.orgId} blocked by compliance`,
    };
  }
  if (!Number.isInteger(request.amountInCents) || request.amountInCents <= 0) {
    return {
      kind: "BLOCKED",
      reason: `invalid amount ${request.amountInCents}, expected integer > 0`,
    };
  }
  if (request.dailyOutflowInCents < 0) {
    return {
      kind: "BLOCKED",
      reason: `invalid dailyOutflow ${request.dailyOutflowInCents}, expected >= 0`,
    };
  }
  const projectedOutflowInCents =
    request.dailyOutflowInCents + request.amountInCents;
  if (projectedOutflowInCents > limits.dailyHumanReviewInCents) {
    return {
      kind: "NEEDS_HUMAN_REVIEW",
      reason: `daily outflow ${projectedOutflowInCents}c would exceed ${limits.dailyHumanReviewInCents}c`,
    };
  }
  if (request.amountInCents >= limits.mfaThresholdInCents) {
    return {
      kind: "NEEDS_MFA",
      reason: `amount ${request.amountInCents}c at or above MFA threshold ${limits.mfaThresholdInCents}c`,
    };
  }
  return { kind: "APPROVED", reason: "within deterministic limits" };
}
