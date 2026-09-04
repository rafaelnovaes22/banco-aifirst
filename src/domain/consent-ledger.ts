// PORQUÊ: nenhum dado do titular é lido sem consentimento ativo para aquela
// finalidade. Open Finance separado de marketing: consentimento é granular.

export type ConsentPurpose = "ONBOARDING" | "OPEN_FINANCE_READ" | "MARKETING";

export interface ConsentRecord {
  readonly orgId: string;
  readonly purpose: ConsentPurpose;
  grantedAtIso?: string;
  revokedAtIso?: string;
}

export class ConsentLedger {
  private readonly consents = new Map<string, ConsentRecord>();

  private keyOf(orgId: string, purpose: ConsentPurpose): string {
    return `${orgId}:${purpose}`;
  }

  grant(orgId: string, purpose: ConsentPurpose, nowIso: string): ConsentRecord {
    const key = this.keyOf(orgId, purpose);
    const existing = this.consents.get(key);
    const record: ConsentRecord = {
      orgId,
      purpose,
      grantedAtIso: nowIso,
      revokedAtIso: undefined,
    };
    // PORQUÊ: re-concessão após revogação cria novo registro, o histórico fica na trilha de auditoria.
    this.consents.set(
      key,
      existing ? { ...record, grantedAtIso: nowIso } : record,
    );
    return this.consents.get(key) as ConsentRecord;
  }

  revoke(
    orgId: string,
    purpose: ConsentPurpose,
    nowIso: string,
  ): ConsentRecord | undefined {
    const record = this.consents.get(this.keyOf(orgId, purpose));
    if (!record || record.revokedAtIso) return record;
    record.revokedAtIso = nowIso;
    return record;
  }

  hasActiveConsent(orgId: string, purpose: ConsentPurpose): boolean {
    const record = this.consents.get(this.keyOf(orgId, purpose));
    return (
      record !== undefined &&
      record.grantedAtIso !== undefined &&
      record.revokedAtIso === undefined
    );
  }

  requireConsent(orgId: string, purpose: ConsentPurpose): void {
    if (!this.hasActiveConsent(orgId, purpose)) {
      throw new Error(
        `blocked access for org ${orgId}: no active consent for purpose ${purpose}`,
      );
    }
  }
}
