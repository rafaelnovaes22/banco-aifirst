import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { AuditEventInput } from "../src/domain/audit-ledger.js";
import type {
  BaasProvider,
  PixOutCommand,
  ProviderPixOutReceipt,
} from "../src/domain/baas-provider.js";
import { MovementLedger } from "../src/domain/movement-ledger.js";
import { OnboardingGate } from "../src/domain/onboarding-gate.js";
import { registerPixOutApi } from "../src/http/api-pix-out.js";

// PORQUÊ: espião em vez de mock genérico. Prova por contagem que dinheiro não se moveu.
class SpyBaasProvider implements BaasProvider {
  public readonly sentCommands: PixOutCommand[] = [];

  async sendPixOut(command: PixOutCommand): Promise<ProviderPixOutReceipt> {
    this.sentCommands.push(command);
    return {
      status: "CONFIRMED",
      baasRef: `baas-${command.idempotencyKey}`,
      amountInCents: command.amountInCents,
    };
  }

  async fetchPixOutStatus(): Promise<ProviderPixOutReceipt | null> {
    return null;
  }
}

function activateOrg(gate: OnboardingGate, orgId: string): void {
  gate.register(orgId, "12.345.678/0001-90");
  gate.applyKycResult(orgId, "APPROVED");
  gate.activate(orgId, "2026-09-03T10:00:00Z");
}

describe("POST /api/pix-out", () => {
  it("conta sem KYC retorna 403 e não move dinheiro", async () => {
    const provider = new SpyBaasProvider();
    const auditInputs: AuditEventInput[] = [];
    const gate = new OnboardingGate();
    gate.register("org-1", "12.345.678/0001-90");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger: new MovementLedger(),
      gate,
      auditSink: (input: AuditEventInput): void => {
        auditInputs.push(input);
      },
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: {
        orgId: "org-1",
        idempotencyKey: "idem-1",
        amountInCents: 10_000,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(provider.sentCommands).toHaveLength(0);
    expect(auditInputs.some((input) => input.channel === "PANEL")).toBe(true);
  });

  it("valor baixo aprovado executa e confirma", async () => {
    const provider = new SpyBaasProvider();
    const ledger = new MovementLedger();
    const auditInputs: AuditEventInput[] = [];
    const gate = new OnboardingGate();
    activateOrg(gate, "org-1");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger,
      gate,
      auditSink: (input: AuditEventInput): void => {
        auditInputs.push(input);
      },
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: {
        orgId: "org-1",
        idempotencyKey: "idem-2",
        amountInCents: 10_000,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("CONFIRMED");
    expect(provider.sentCommands).toHaveLength(1);
    expect(ledger.get("idem-2")?.status).toBe("CONFIRMED");
    expect(auditInputs.some((input) => input.channel === "PANEL")).toBe(true);
  });

  it("R$600 sem mfaVerified retorna NEEDS_MFA e não move dinheiro", async () => {
    const provider = new SpyBaasProvider();
    const gate = new OnboardingGate();
    activateOrg(gate, "org-1");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger: new MovementLedger(),
      gate,
      auditSink: (): void => {},
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: {
        orgId: "org-1",
        idempotencyKey: "idem-3",
        amountInCents: 60_000,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("NEEDS_MFA");
    expect(provider.sentCommands).toHaveLength(0);
  });

  it("R$600 com mfaVerified executa", async () => {
    const provider = new SpyBaasProvider();
    const gate = new OnboardingGate();
    activateOrg(gate, "org-1");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger: new MovementLedger(),
      gate,
      auditSink: (): void => {},
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: {
        orgId: "org-1",
        idempotencyKey: "idem-4",
        amountInCents: 60_000,
        mfaVerified: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("CONFIRMED");
    expect(provider.sentCommands).toHaveLength(1);
  });

  it("valor que estoura o dia vai para humano sem mover dinheiro", async () => {
    const provider = new SpyBaasProvider();
    const gate = new OnboardingGate();
    activateOrg(gate, "org-1");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger: new MovementLedger(),
      gate,
      auditSink: (): void => {},
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: {
        orgId: "org-1",
        idempotencyKey: "idem-5",
        amountInCents: 250_000,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("NEEDS_HUMAN_REVIEW");
    expect(provider.sentCommands).toHaveLength(0);
  });

  it("valor inválido é BLOCKED sem mover dinheiro", async () => {
    const provider = new SpyBaasProvider();
    const gate = new OnboardingGate();
    activateOrg(gate, "org-1");
    const app = Fastify();
    await registerPixOutApi(app, {
      provider,
      ledger: new MovementLedger(),
      gate,
      auditSink: (): void => {},
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/pix-out",
      payload: { orgId: "org-1", idempotencyKey: "idem-6", amountInCents: -5 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("BLOCKED");
    expect(provider.sentCommands).toHaveLength(0);
  });
});
