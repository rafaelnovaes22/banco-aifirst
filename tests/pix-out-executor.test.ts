import { describe, expect, it } from "vitest";
import {
  SandboxBaasProvider,
  type BaasProvider,
  type ProviderPixOutReceipt,
} from "../src/domain/baas-provider.js";
import { MovementLedger } from "../src/domain/movement-ledger.js";
import {
  executePixOut,
  type AuditSink,
} from "../src/domain/pix-out-executor.js";
import {
  appendAuditEvent,
  type AuditEvent,
  type AuditEventInput,
} from "../src/domain/audit-ledger.js";

const command = {
  idempotencyKey: "idem-1",
  orgId: "org-1",
  amountInCents: 10_000,
} as const;

function buildExecutorHarness(provider: BaasProvider) {
  const ledger = new MovementLedger();
  const auditChain: AuditEvent[] = [];
  const auditSink: AuditSink = (input: AuditEventInput) => {
    auditChain.push(appendAuditEvent(auditChain, input));
  };
  return {
    ledger,
    auditChain,
    execute: () => executePixOut(provider, ledger, command, auditSink),
  };
}

describe("executePixOut", () => {
  it("confirma Pix no caminho feliz e registra na trilha com baasRef", async () => {
    const { auditChain, execute } = buildExecutorHarness(
      new SandboxBaasProvider(),
    );
    const movement = await execute();
    expect(movement.status).toBe("CONFIRMED");
    expect(movement.baasRef).toBe("baas-idem-1");
    expect(auditChain.map((event) => event.action)).toEqual([
      "PIX_OUT_CONFIRMED",
    ]);
  });

  it("timeout do BaaS vira PENDING_CONFIRM, nunca sucesso presumido", async () => {
    const { execute } = buildExecutorHarness(
      new SandboxBaasProvider("timeout"),
    );
    const movement = await execute();
    expect(movement.status).toBe("PENDING_CONFIRM");
    expect(movement.failureReason).toContain("timeout");
  });

  it("rejeição do BaaS vira REJECTED com motivo", async () => {
    const { execute } = buildExecutorHarness(new SandboxBaasProvider("reject"));
    const movement = await execute();
    expect(movement.status).toBe("REJECTED");
    expect(movement.failureReason).toContain("compliance");
  });

  it("execução duplicada com a mesma chave não move dinheiro duas vezes", async () => {
    const provider = new SandboxBaasProvider();
    const { ledger, execute } = buildExecutorHarness(provider);
    const first = await execute();
    const second = await execute();
    expect(second).toBe(first);
    expect(ledger.pendingMovements()).toHaveLength(0);
    expect(ledger.get("idem-1")?.status).toBe("CONFIRMED");
  });

  it("valor confirmado diferente do enviado vira pendente divergente (humano decide)", async () => {
    const divergentProvider: BaasProvider = {
      async sendPixOut(): Promise<ProviderPixOutReceipt> {
        return {
          status: "CONFIRMED",
          baasRef: "baas-x",
          amountInCents: 99_999,
        };
      },
      async fetchPixOutStatus(): Promise<ProviderPixOutReceipt | null> {
        return null;
      },
    };
    const { execute } = buildExecutorHarness(divergentProvider);
    const movement = await execute();
    expect(movement.status).toBe("PENDING_CONFIRM");
    expect(movement.divergent).toBe(true);
    expect(movement.failureReason).toContain("divergent amount");
  });
});
