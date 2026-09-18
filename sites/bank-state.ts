import type { BankApproval, BankState, SandboxCharge } from "./types.ts";

// PORQUÊ: seed idêntico ao runtime Node para o cockpit abrir igual nos dois ambientes.
const DAY_IN_MS = 86_400_000;

function isoOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_IN_MS).toISOString();
}

function seedApproval(now: Date): BankApproval {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "cash",
    label: "RESERVA SUGERIDA",
    title: "Separar R$ 42.000 para reserva",
    detail: "Mantém 60 dias de operação sem depender de novas entradas.",
    amountInCents: 4_200_000,
    creatorId: "seed",
    createdAt: now.toISOString(),
    status: "PENDING",
    version: 1,
  };
}

function seedCharge(
  id: string,
  customerName: string,
  amountInCents: number,
  dueDate: string,
  now: Date,
): SandboxCharge {
  return {
    id,
    customerName,
    amountInCents,
    dueDate,
    createdAt: now.toISOString(),
    status: "OPEN",
    version: 1,
  };
}

export function createDemoBankState(orgId: string, now: Date): BankState {
  return {
    orgId,
    displayName: "Novaes Comércio Ltda.",
    balanceInCents: 28_734_000,
    forecastInCents: 34_180_000,
    receivablesInCents: 18_420_000,
    expensesInCents: 12_974_000,
    riskScore: 12,
    version: 1,
    updatedAt: now.toISOString(),
    approvals: [seedApproval(now)],
    movements: [
      {
        id: "movement-seed-in",
        direction: "IN",
        description: "Recebimento sandbox, Aurora Arquitetura",
        amountInCents: 684_000,
        occurredAt: isoOffset(now, -1),
        status: "CONFIRMED",
      },
    ],
    charges: [
      seedCharge(
        "charge-aurora",
        "Aurora Arquitetura",
        684_000,
        isoOffset(now, 3),
        now,
      ),
      seedCharge(
        "charge-verde",
        "Verde Campo Ltda.",
        319_000,
        isoOffset(now, 7),
        now,
      ),
    ],
    recipients: [
      {
        id: "recipient-union",
        name: "Union Select Fornecimentos",
        keyType: "EMAIL",
        keyMasked: "u***@sandbox.local",
        verified: true,
      },
      {
        id: "recipient-orbita",
        name: "Órbita Contabilidade",
        keyType: "EVP",
        keyMasked: "***-sandbox-9f2",
        verified: true,
      },
    ],
    receipts: {},
  };
}

export function riskLabel(score: number): string {
  if (score <= 25) return "Baixo";
  if (score <= 60) return "Moderado";
  return "Alto";
}

export function toCockpitView(
  state: BankState,
  sessionId: string,
): Record<string, unknown> {
  return {
    company: {
      name: state.displayName,
      sessionLabel: `SANDBOX ${sessionId.slice(0, 8).toUpperCase()}`,
    },
    money: {
      balanceInCents: state.balanceInCents,
      forecastInCents: state.forecastInCents,
      receivablesInCents: state.receivablesInCents,
      expensesInCents: state.expensesInCents,
    },
    risk: { score: state.riskScore, label: riskLabel(state.riskScore) },
    approvals: state.approvals.filter(
      (approval) => approval.status === "PENDING",
    ),
    movements: state.movements.slice(0, 12),
    charges: state.charges.slice(0, 12),
    recipients: state.recipients,
    stateVersion: state.version,
    updatedAt: state.updatedAt,
  };
}
