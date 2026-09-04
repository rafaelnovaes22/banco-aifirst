// PORQUÊ: Port do parceiro regulado. O executor é o único lugar com essa
// dependência. Trocar BaaS não toca em nenhuma outra parte do sistema.

import { z } from "zod";

// PORQUÊ: integração externa nasce no Sandbox. Produção só entra quando o
// chamador fornece explicitamente outra base URL.
// Fontes: https://docs.asaas.com/docs/authentication
// https://docs.asaas.com/reference/transfer-to-another-institution-account-or-pix-key
// https://docs.asaas.com/reference/retrieve-a-single-transfer
const DEFAULT_ASAAS_BASE_URL = "https://api-sandbox.asaas.com/v3";
const DEFAULT_ASAAS_USER_AGENT = "BancoAIFirst/0.1.0 (Node.js; sandbox)";
const CONFIRMED_ASAAS_STATUSES = new Set(["DONE"]);
const REJECTED_ASAAS_STATUSES = new Set(["CANCELLED", "FAILED"]);
const PENDING_ASAAS_STATUSES = new Set(["PENDING", "BANK_PROCESSING"]);

const AsaasTransferResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  failReason: z.string().nullable().optional(),
});

type AsaasTransferResponse = z.infer<typeof AsaasTransferResponseSchema>;

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
  readonly pixAddressKey?: string;
  readonly pixAddressKeyType?: PixAddressKeyType;
}

export type PixAddressKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

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
    providerReference: string,
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
  private readonly userAgent: string;

  constructor(
    apiKey: string,
    baseUrl: string = DEFAULT_ASAAS_BASE_URL,
    private readonly httpClient: AsaasHttpClient = fetchJson,
    userAgent: string = DEFAULT_ASAAS_USER_AGENT,
  ) {
    if (!apiKey.trim()) throw new Error("ASAAS_API_KEY não pode ficar vazio");
    if (!baseUrl.trim()) throw new Error("ASAAS_BASE_URL não pode ficar vazio");
    if (!userAgent.trim())
      throw new Error("ASAAS_USER_AGENT não pode ficar vazio");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.userAgent = userAgent;
  }

  async sendPixOut(command: PixOutCommand): Promise<ProviderPixOutReceipt> {
    const response = await this.request<unknown>(
      "/transfers",
      "POST",
      buildPixTransferPayload(command),
    );
    const transfer = parseAsaasTransferResponse(
      response,
      "criação de transferência",
    );
    return mapCreatedTransfer(transfer);
  }

  async fetchPixOutStatus(
    providerTransferId: string,
  ): Promise<ProviderPixOutReceipt | null> {
    if (!providerTransferId.trim()) {
      throw new Error("providerTransferId não pode ficar vazio");
    }
    const response = await this.request<unknown>(
      `/transfers/${encodeURIComponent(providerTransferId)}`,
      "GET",
    );
    const transfer = parseAsaasTransferResponse(
      response,
      "consulta de transferência",
    );
    return mapFetchedTransfer(transfer);
  }

  private async request<T>(
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.httpClient(`${this.baseUrl}${path}`, {
      method,
      headers: {
        access_token: this.apiKey,
        "User-Agent": this.userAgent,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Asaas ${method} ${path} retornou HTTP ${response.status}`,
      );
    }
    return response.json() as Promise<T>;
  }
}

function buildPixTransferPayload(
  command: PixOutCommand,
): Record<string, unknown> {
  if (!Number.isInteger(command.amountInCents) || command.amountInCents <= 0) {
    throw new Error(
      `amountInCents inválido: ${command.amountInCents}, esperado inteiro > 0`,
    );
  }
  if (!command.pixAddressKey?.trim() || !command.pixAddressKeyType) {
    throw new Error(
      `Pix Asaas ${command.idempotencyKey} sem pixAddressKey ou pixAddressKeyType`,
    );
  }
  return {
    value: command.amountInCents / 100,
    pixAddressKey: command.pixAddressKey,
    pixAddressKeyType: command.pixAddressKeyType,
    externalReference: command.idempotencyKey,
  };
}

function parseAsaasTransferResponse(
  raw: unknown,
  operation: string,
): AsaasTransferResponse {
  const parsed = AsaasTransferResponseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]?.message ?? "schema desconhecido";
  throw new Error(`contrato Asaas inválido em ${operation}: ${issue}`);
}

function mapCreatedTransfer(
  transfer: AsaasTransferResponse,
): ProviderPixOutReceipt {
  const status = transfer.status.toUpperCase();
  if (isAsaasRejectedStatus(status)) return rejectedTransfer(transfer);
  if (isAsaasPendingStatus(status)) {
    throw new Error(
      `transferência Asaas ${transfer.id} com status assíncrono ${status}`,
    );
  }
  if (!isAsaasConfirmedStatus(status)) {
    throw new Error(
      `transferência Asaas ${transfer.id} com status desconhecido ${status}`,
    );
  }
  return confirmedTransfer(transfer);
}

function mapFetchedTransfer(
  transfer: AsaasTransferResponse,
): ProviderPixOutReceipt | null {
  const status = transfer.status.toUpperCase();
  if (isAsaasPendingStatus(status)) return null;
  if (isAsaasRejectedStatus(status)) return rejectedTransfer(transfer);
  if (!isAsaasConfirmedStatus(status)) {
    throw new Error(
      `transferência Asaas ${transfer.id} com status desconhecido ${status}`,
    );
  }
  return confirmedTransfer(transfer);
}

function rejectedTransfer(
  transfer: AsaasTransferResponse,
): ProviderPixOutReceipt {
  return {
    status: "REJECTED",
    reason: transfer.failReason ?? `asaas status ${transfer.status}`,
  };
}

function confirmedTransfer(
  transfer: AsaasTransferResponse,
): ProviderPixOutReceipt {
  return {
    status: "CONFIRMED",
    baasRef: transfer.id,
    amountInCents: toCents(transfer.value),
  };
}

function toCents(value: unknown): number {
  const valueInReais =
    typeof value === "number"
      ? value
      : Number.parseFloat(
          typeof value === "string" ? value.replace(",", ".") : "NaN",
        );
  if (!Number.isFinite(valueInReais) || valueInReais < 0) {
    throw new Error(
      `valor monetário inválido no contrato Asaas: ${String(value)}`,
    );
  }
  return Math.round(valueInReais * 100);
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
