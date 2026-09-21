import { describe, expect, it } from "vitest";
import {
  SandboxBaasProvider,
  type BaasProvider,
  type ProviderPixOutReceipt,
} from "../src/domain/baas-provider.js";
import { MovementLedger } from "../src/domain/movement-ledger.js";
import { executePixOut } from "../src/domain/pix-out-executor.js";
import { reconcilePendingMovements } from "../src/domain/reconciliation.js";

const command = {
  idempotencyKey: "idem-1",
  orgId: "org-1",
  amountInCents: 10_000,
} as const;

const noOpAudit = (): void => undefined;

describe("reconcilePendingMovements", () => {
  it("recupera Pix perdido por timeout: pendente vira confirmado via polling", async () => {
    const provider = new SandboxBaasProvider("timeout");
    const ledger = new MovementLedger();
    await executePixOut(provider, ledger, command, noOpAudit);
    const report = await reconcilePendingMovements(provider, ledger);
    expect(report.confirmed).toBe(1);
    expect(ledger.get("idem-1")?.status).toBe("CONFIRMED");
  });

  it("mantém pendente quando o BaaS não conhece a chave (ainda sem resposta)", async () => {
    const unknownProvider: BaasProvider = {
      async sendPixOut(): Promise<ProviderPixOutReceipt> {
        throw new Error("network down before reaching baas");
      },
      async fetchPixOutStatus(): Promise<ProviderPixOutReceipt | null> {
        return null;
      },
    };
    const ledger = new MovementLedger();
    await executePixOut(unknownProvider, ledger, command, noOpAudit);
    const report = await reconcilePendingMovements(unknownProvider, ledger);
    expect(report.stillPending).toBe(1);
    expect(ledger.get("idem-1")?.status).toBe("PENDING_CONFIRM");
  });

  it("fecha como FAILED quando o polling devolve rejeição", async () => {
    const rejectOnFetch: BaasProvider = {
      async sendPixOut(): Promise<ProviderPixOutReceipt> {
        throw new Error("timeout");
      },
      async fetchPixOutStatus(): Promise<ProviderPixOutReceipt | null> {
        return { status: "REJECTED", reason: "baas blocked key after review" };
      },
    };
    const ledger = new MovementLedger();
    await executePixOut(rejectOnFetch, ledger, command, noOpAudit);
    const report = await reconcilePendingMovements(rejectOnFetch, ledger);
    expect(report.failed).toBe(1);
    expect(ledger.get("idem-1")?.status).toBe("FAILED");
    expect(ledger.get("idem-1")?.failureReason).toContain("blocked");
  });

  it("valor divergente no polling nunca auto-confirma: sobe para humano", async () => {
    const divergentOnFetch: BaasProvider = {
      async sendPixOut(): Promise<ProviderPixOutReceipt> {
        throw new Error("timeout");
      },
      async fetchPixOutStatus(): Promise<ProviderPixOutReceipt | null> {
        return {
          status: "CONFIRMED",
          baasRef: "baas-x",
          amountInCents: 123_456,
        };
      },
    };
    const ledger = new MovementLedger();
    await executePixOut(divergentOnFetch, ledger, command, noOpAudit);
    const report = await reconcilePendingMovements(divergentOnFetch, ledger);
    expect(report.divergentKeys).toEqual(["idem-1"]);
    expect(ledger.get("idem-1")?.status).toBe("PENDING_CONFIRM");
    expect(ledger.get("idem-1")?.divergent).toBe(true);
  });
});
