// PORQUÊ: governança visível no produto. Sem alegar certificação ou operação real.
export function governance(): Record<string, unknown> {
  return {
    mode: "sandbox",
    llm_enabled: false,
    live_finance: false,
    certified_iso42001: false,
    quality_gate: 0.95,
    controls: [
      {
        id: "HITL-01",
        title: "Dinheiro pede humano",
        status: "implemented",
        evidence:
          "Pagamento, reserva, tributo, bloqueio e política exigem aprovação.",
      },
      {
        id: "PAY-01",
        title: "Alçada e maker-checker",
        status: "implemented",
        evidence:
          "Alçada de R$ 5.000, favorecido verificado e aprovador diferente do criador.",
      },
      {
        id: "AUDIT-01",
        title: "Auditoria verificável",
        status: "implemented",
        evidence:
          "SHA-256 encadeado, D1 transacional e triggers contra alteração. Sem ancoragem externa.",
      },
      {
        id: "SEC-01",
        title: "Sessão e origem",
        status: "implemented",
        evidence:
          "Token opaco com hash em disco, CSRF, origem exata, CSP e rate limit.",
      },
      {
        id: "AI-01",
        title: "IA sem execução",
        status: "implemented",
        evidence:
          "Classificador determinístico. Modelo sugere rascunho, nunca executa.",
      },
      {
        id: "PENTEST-01",
        title: "Avaliação independente",
        status: "pending",
        evidence: "Testes locais não substituem pentest independente.",
      },
    ],
    limitations: [
      "Sandbox demonstrativo. Nenhum Pix, boleto ou dinheiro real é movimentado.",
      "Fluxo não é instituição financeira: sem contas, depósitos, crédito ou KYC real.",
      "Acesso do Sites não constitui identidade financeira, MFA empresarial ou mandato.",
      "Backup operacional, pentest independente e homologação para dados reais não concluídos.",
    ],
  };
}
