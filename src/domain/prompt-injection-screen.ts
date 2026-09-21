// PORQUÊ: triagem de prompt injection na borda. Mensagem suspeita nunca vira
// pedido de movimento: rota para ticket humano com protocolo. Fail-closed por design.

const INJECTION_PATTERNS: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  {
    label: "IGNORE_RULES",
    pattern: /ignore\s+(?:\w+\s+){0,1}(?:regras|instru[çc][õo]es|limites)/i,
  },
  {
    label: "DISABLE_RULES",
    pattern:
      /desative\s+(?:\w+\s+){0,1}(?:regras|prote[çc][õo]es|prote[çc][ãa]o|limites)/i,
  },
  {
    label: "CLAIMS_ADMIN",
    pattern: /voc[êe]\s+(?:é|e[sr])\s+(?:admin|administrador|o dono)/i,
  },
  {
    label: "AUTHORITY_TRANSFER",
    pattern:
      /agora\s+(?:voc[êe]|vc)\s+(?:pode|deve)\s+(?:mover|transferir|enviar)/i,
  },
  {
    label: "MOVE_MONEY",
    pattern: /(?:transfira|transfere|envie|mande)\s+(?:tudo|todo o saldo|r\$)/i,
  },
  { label: "RAISE_LIMIT", pattern: /aumente\s+(?:meu\s+|o\s+)?limite/i },
  {
    label: "SKIP_VERIFICATION",
    pattern: /sem\s+(?:mfa|autentica[çc][ãa]o|confirma[çc][ãa]o)/i,
  },
  {
    label: "BYPASS_STEP",
    pattern:
      /pul(?:a|ar|e|ou|ando)\s+(?:o\s+|a\s+)?(?:mfa|kyc|aprova[çc][ãa]o|autentica[çc][ãa]o)/i,
  },
  {
    label: "THIRD_PARTY_AUTHORITY",
    pattern: /(?:dono|fundador|s[óo]cio)\s+(?:mandou|autorizou|disse|liberou)/i,
  },
  {
    label: "PROMPT_PROBE",
    pattern: /(?:prompt|system)\s+(?:novo|anterior|inicial|do sistema)/i,
  },
  {
    label: "SECRET_PROBE",
    pattern:
      /revel(?:a|e|o)?\s+(?:o\s+|a\s+)?(?:prompt|chave|api|token|segredo)/i,
  },
  {
    label: "FAKE_AI_APPROVAL",
    pattern: /aprovad[oa]\s+(?:pela\s+)?(?:ia|intelig[êe]ncia artificial)/i,
  },
];

export interface InboundScreeningResult {
  readonly suspicious: boolean;
  readonly matchedLabels: readonly string[];
}

export function screenInboundMessage(text: string): InboundScreeningResult {
  const matchedLabels = INJECTION_PATTERNS.filter((candidate) =>
    candidate.pattern.test(text),
  ).map((candidate) => candidate.label);
  return { suspicious: matchedLabels.length > 0, matchedLabels };
}
