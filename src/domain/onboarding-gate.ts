// PORQUÊ: KYC é do parceiro BaaS, nós só espelhamos o resultado. Conta só
// opera com status APPROVED. Fail-closed: sem resultado, não opera.

export type KycStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface OrganizationOnboarding {
  readonly orgId: string;
  readonly cnpj: string;
  kycStatus: KycStatus;
  activatedAtIso?: string;
}

export class OnboardingGate {
  private readonly organizations = new Map<string, OrganizationOnboarding>();

  register(orgId: string, cnpj: string): OrganizationOnboarding {
    const organization: OrganizationOnboarding = {
      orgId,
      cnpj,
      kycStatus: "PENDING",
    };
    this.organizations.set(orgId, organization);
    return organization;
  }

  applyKycResult(
    orgId: string,
    kycStatus: KycStatus,
  ): OrganizationOnboarding | undefined {
    const organization = this.organizations.get(orgId);
    if (!organization) return undefined;
    organization.kycStatus = kycStatus;
    return organization;
  }

  activate(orgId: string, nowIso: string): OrganizationOnboarding {
    const organization = this.organizations.get(orgId);
    // PORQUÊ: ativar sem KYC aprovado é exatamente o erro que o regulador pune. Trava aqui.
    if (!organization || organization.kycStatus !== "APPROVED") {
      throw new Error(
        `cannot activate org ${orgId}: kyc status is ${organization?.kycStatus ?? "NOT_REGISTERED"}, expected APPROVED`,
      );
    }
    organization.activatedAtIso = nowIso;
    return organization;
  }

  isAccountOperational(orgId: string): boolean {
    const organization = this.organizations.get(orgId);
    return (
      organization?.kycStatus === "APPROVED" &&
      organization.activatedAtIso !== undefined
    );
  }
}
