// PORQUÊ: Port do parceiro regulado. O executor é o único lugar com essa
// dependência. Trocar BaaS não toca em nenhuma outra parte do sistema.

import { z } from "zod";

const DEFAULT_ASAAS_BASE_URL = "https://api.asaas.com/api/v3";
const CONFIRMED_ASAAS_STATUSES = new Set([
  "CONFIRMED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "RECEIVED",
  "PAID",
]);

const REJECTED_ASAAS_STATUSES = new Set([
  "FAILED",
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "BLOCKED",
  "OVERDUE",
]);

const PENDING_ASAAS_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "AWAITING_PAYMENT",
  "SCHEDULED",
]);

const toCents = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return Math.max(
      0,
      Math.round(Number.parseFloat(value.replace(",", ".")) * 100),
    );
  }
  throw new Error("valor monetário inválido no contrato Asaas");
};

const AsaasCreateResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  amountInCents: z.number().int().nonnegative().optional(),
});

const AsaasGetResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  amountInCents: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});

const isAsaasRejectedStatus = (status: string): boolean =>
  REJECTED_ASAAS_STATUSES.has(status);
const isAsaasConfirmedStatus = (status: string): boolean =>
  CONFIRMED_ASAAS_STATUSES.has(status);
const isAsaasPendingStatus = (status: string): boolean =>
  PENDING_ASAAS_STATUSES.has(status);

type AsaasHttpClient = (
  input: string,
  init?: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

export interface PixOutCommand {
  readonly idempotencyKey: string;
  readonly orgId: string;
  readonly amountInCents: number;
}

export type ProviderPixOutReceipt =
  | {
      readonly status: "CONFIRMED";
      readonly baasRef: string;
      readonly amountInCents: number;
    }
  | { readonly status: "REJECTED"; readonly reason: string };

export interface BaasProvider {
  sendPixOut(command: PixOutCommand): Promise<ProviderPixOutReceipt>;
  fetchPixOutStatus(
    idempotencyKey: string,
  ): Promise<ProviderPixOutReceipt | null>;
}

export type SandboxFailureMode = "none" | "timeout" | "reject";

export class SandboxBaasProvider implements BaasProvider {
  private readonly sentPixOuts = new Map<string, ProviderPixOutReceipt>();

  constructor(private readonly failureMode: SandboxFailureMode = "none") {}

  async sendPixOut(command: PixOutCommand): Promise<ProviderPixOutReceipt> {
    const receipt: ProviderPixOutReceipt =
      this.failureMode === "reject"
        ? {
            status: "REJECTED",
            reason: `sandbox compliance rule for org ${command.orgId}`,
          }
        : {
            status: "CONFIRMED",
            baasRef: `baas-${command.idempotencyKey}`,
            amountInCents: command.amountInCents,
          };
    this.sentPixOuts.set(command.idempotencyKey, receipt);
    // PORQUÊ: timeout simula resposta perdida. O Pix chegou no BaaS, o retorno não.
    // A reconciliação por polling precisa ser capaz de achar esse Pix depois.
    if (this.failureMode === "timeout") {
      throw new Error(
        `sandbox timeout after commit for key ${command.idempotencyKey}`,
      );
    }
    return receipt;
  }

  async fetchPixOutStatus(
    idempotencyKey: string,
  ): Promise<ProviderPixOutReceipt | null> {
    return this.sentPixOuts.get(idempotencyKey) ?? null;
  }
}

export class AsaasBaasProvider implements BaasProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    apiKey: string,
    baseUrl: string = DEFAULT_ASAAS_BASE_URL,
    private readonly httpClient: AsaasHttpClient = fetchJson,
  ) {
    if (!apiKey.trim()) throw new Error("ASAAS_API_KEY não pode ficar vazio");
    if (!baseUrl.trim()) throw new Error("ASAAS_BASE_URL não pode ficar vazio");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async sendPixOut(command: PixOutCommand): Promise<ProviderPixOutReceipt> {
    const response = await this.request<
      z.infer<typeof AsaasCreateResponseSchema>
    >("/payments", "POST", {
      value: command.amountInCents / 100,
      externalReference: command.idempotencyKey,
      idempotencyKey: command.idempotencyKey,
      orgId: command.orgId,
    });
    const parsed = AsaasCreateResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new Error("contrato de criação do Asaas inválido");
    const status = parsed.data.status.toUpperCase();
    if (isAsaasRejectedStatus(status)) {
      return {
        status: "REJECTED",
        reason: `asaas status ${parsed.data.status}`,
      };
    }
    if (!isAsaasConfirmedStatus(status)) {
      if (isAsaasPendingStatus(status)) {
        throw new Error(
          `status assíncrono do Asaas para criação: ${parsed.data.status}`,
        );
      }
      throw new Error(
        `status de criação do Asaas desconhecido: ${parsed.data.status}`,
      );
    }
    const amountInCents = extractAmountFromAsaas(parsed.data);
    return { status: "CONFIRMED", baasRef: parsed.data.id, amountInCents };
  }

  async fetchPixOutStatus(
    idempotencyKey: string,
  ): Promise<ProviderPixOutReceipt | null> {
    const response = await this.request<z.infer<typeof AsaasGetResponseSchema>>(
      `/payments/${encodeURIComponent(idempotencyKey)}`,
      "GET",
    );
    const parsed = AsaasGetResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new Error("contrato de consulta do Asaas inválido");
    const status = parsed.data.status.toUpperCase();
    if (isAsaasRejectedStatus(status)) {
      return {
        status: "REJECTED",
        reason: parsed.data.reason ?? `asaas status ${parsed.data.status}`,
      };
    }
    if (isAsaasPendingStatus(status)) return null;
    if (!isAsaasConfirmedStatus(status)) {
      throw new Error(
        `status de consulta do Asaas desconhecido: ${parsed.data.status}`,
      );
    }
    const amountInCents = extractAmountFromAsaas(parsed.data);
    return { status: "CONFIRMED", baasRef: parsed.data.id, amountInCents };
  }

  private async request<T>(
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.httpClient(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Asaas HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

function extractAmountFromAsaas(payload: {
  amountInCents?: number;
  value?: string | number;
}): number {
  if (payload.amountInCents !== undefined) return payload.amountInCents;
  return toCents(payload.value);
}

async function fetchJson(
  input: string,
  init?: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const response = await fetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    json: (): Promise<unknown> => response.json(),
  };
}
