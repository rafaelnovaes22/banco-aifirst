import { verifyAuditChain } from "./audit-chain.js";
import type {
  AuditRecord,
  CockpitView,
  CommandResult,
  SessionIdentity,
} from "./contracts.js";
import {
  decideApproval,
  runCommand,
  type ApprovalDecisionResult,
} from "./command-engine.js";
import { toCockpitView } from "./demo-state.js";
import type { BankRepository } from "./repository.js";
import { RuntimeError } from "./runtime-error.js";
import {
  executarConciliacao,
  type ConciliacaoResumo,
} from "../b2b/conciliacao.js";
import { executarDreContinuo, type DreResumo } from "../b2b/dre.js";
import { executarPilotoShadow } from "../b2b/piloto-shadow.js";
import type { ShadowPremissas } from "../b2b/piloto-shadow.js";
import {
  MemoriaExtratoProvider,
  parseCsvExtrato,
  type B2bExtratoMovement,
} from "../b2b/extrato-provider.js";
import type { ReceiptExtraction } from "../domain/receipt-extraction.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  sessionExpiry,
} from "./session-security.js";

export interface StartedSession {
  readonly csrfToken: string;
  readonly sessionToken: string;
  readonly session: SessionIdentity;
}

export interface AuditView {
  readonly records: readonly AuditRecord[];
  readonly integrity: "VERIFIED" | "COMPROMISED";
}

export interface PilotoShadowInput {
  readonly csv: string;
  readonly extracoes: readonly ReceiptExtraction[];
  readonly premissas: ShadowPremissas;
  readonly nomeOrgao: string;
}

export interface PilotoShadowRelatorio {
  readonly totalExtrato: number;
  readonly resumo: ConciliacaoResumo;
  readonly linhasDre: DreResumo["linhas"];
  readonly taxaAutoBaixa: number;
  readonly horasEconomizadasMes: number;
  readonly economiaMensalEmCentavos: number;
  readonly textoResumoDre: string;
}

const SHADOW_MOVIMENTOS_MAX = 2_000;

export class BankApplication {
  public constructor(private readonly repository: BankRepository) {}

  public async startSession(
    existingToken: string | null,
    now: Date,
  ): Promise<StartedSession> {
    const existing = existingToken
      ? await this.authenticate(existingToken, now)
      : null;
    const csrfToken = createOpaqueToken();
    if (existing && existingToken) {
      await this.repository.rotateCsrf(
        existing.sessionId,
        hashOpaqueToken(csrfToken),
      );
      return { csrfToken, sessionToken: existingToken, session: existing };
    }
    return this.createSession(csrfToken, now);
  }

  private async createSession(
    csrfToken: string,
    now: Date,
  ): Promise<StartedSession> {
    const sessionToken = createOpaqueToken();
    const session = await this.repository.createSession({
      tokenHash: hashOpaqueToken(sessionToken),
      csrfHash: hashOpaqueToken(csrfToken),
      now,
      expiresAt: sessionExpiry(now),
    });
    return { csrfToken, sessionToken, session };
  }

  public async authenticate(
    token: string,
    now: Date,
  ): Promise<SessionIdentity | null> {
    if (!token || token.length > 128) return null;
    return this.repository.findSession(hashOpaqueToken(token), now);
  }

  public async authorizeMutation(
    identity: SessionIdentity,
    csrfToken: string,
    now: Date,
  ): Promise<void> {
    const valid = await this.repository.verifyCsrf(
      identity.sessionId,
      hashOpaqueToken(csrfToken),
      now,
    );
    if (!valid)
      throw new RuntimeError(
        403,
        "CSRF_INVALID",
        "Atualize a sessão antes de executar uma ação.",
      );
  }

  public async cockpit(identity: SessionIdentity): Promise<CockpitView> {
    const state = await this.repository.readState(identity.orgId);
    return toCockpitView(state, identity.sessionId);
  }

  public async command(
    identity: SessionIdentity,
    text: unknown,
    idempotencyKey: string,
    now: Date,
  ): Promise<CommandResult> {
    return this.repository.mutateState(
      identity.orgId,
      (state) => runCommand(state, text, idempotencyKey, now),
      now,
    );
  }

  public async approvalDecision(
    identity: SessionIdentity,
    approvalId: string,
    decision: "APPROVE" | "REJECT",
    expectedVersion: number,
    idempotencyKey: string,
    now: Date,
  ): Promise<ApprovalDecisionResult> {
    return this.repository.mutateState(
      identity.orgId,
      (state) =>
        decideApproval(
          state,
          approvalId,
          decision,
          expectedVersion,
          idempotencyKey,
          now,
        ),
      now,
    );
  }

  public async audit(identity: SessionIdentity): Promise<AuditView> {
    const records = await this.repository.listAudit(identity.orgId);
    return {
      records: records.slice(-100),
      integrity: verifyAuditChain(records) ? "VERIFIED" : "COMPROMISED",
    };
  }

  public async auditCsv(identity: SessionIdentity): Promise<string> {
    const records = await this.repository.listAudit(identity.orgId);
    const rows = records.map((record) => recordToCsv(record));
    return `\uFEFF${[
      "seq,recordedAt,agent,action,objectId,channel,status,detail,prevHash,hash",
      ...rows,
    ].join("\n")}`;
  }

  // PORQUÊ: shadow em leitura no backend: mesmo cálculo do Pages e do CLI,
  // sem mover dinheiro e sem encostar no ledger. A trilha desta chamada vai
  // para o log estruturado, não para a cadeia com hash (só mutação entra lá).
  public async pilotoShadow(
    input: PilotoShadowInput,
  ): Promise<PilotoShadowRelatorio> {
    const provider = new MemoriaExtratoProvider(shadowMovimentos(input.csv));
    const { resumo } = await executarConciliacao(provider, input.extracoes, []);
    const dre = await executarDreContinuo(provider, input.nomeOrgao);
    const relatorio = await executarPilotoShadow(
      provider,
      input.extracoes,
      input.premissas,
      input.nomeOrgao,
    );
    return {
      totalExtrato: resumo.totalExtrato,
      resumo,
      linhasDre: dre.linhas,
      taxaAutoBaixa: relatorio.taxaAutoBaixa,
      horasEconomizadasMes: relatorio.horasEconomizadasMes,
      economiaMensalEmCentavos: relatorio.economiaMensalEmCentavos,
      textoResumoDre: relatorio.textoResumoDre,
    };
  }
}

function shadowMovimentos(csv: string): readonly B2bExtratoMovement[] {
  const movimentos = parseCsvExtrato(csv);
  if (movimentos.length === 0 || movimentos.length > SHADOW_MOVIMENTOS_MAX)
    throw new RuntimeError(
      422,
      "INVALID_EXTRATO",
      `Extrato sem movimento válido: recebidos ${movimentos.length}.`,
    );
  return movimentos;
}

function recordToCsv(record: AuditRecord): string {
  return [
    record.seq,
    record.recordedAt,
    record.agent,
    record.action,
    record.objectId,
    record.channel,
    record.status,
    record.detail,
    record.prevHash,
    record.hash,
  ]
    .map(csvCell)
    .join(",");
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
