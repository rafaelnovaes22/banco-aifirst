import type { CommandAction, CommandIntent, CommandPlan } from "./contracts.js";

export const MAX_COMMAND_LENGTH = 240;
export const QUALITY_GATE = 0.95;

const PROHIBITED_PATTERNS: readonly RegExp[] = [
  /ignore\s+(previous|prior|above)\s+(instructions?|rules?)/i,
  /ignore\s+all\s+(instructions?|rules?)/i,
  /disregard\s+(the\s+)?(instructions?|rules?)/i,
  /forget\s+(everything|all|previous)/i,
  /esque[cç]a\s+(as\s+)?(instru[cç][oõ]es|regras)/i,
  /ignore\s+(todas?\s+)?(as\s+)?instru[cç][oõ]es/i,
  /desconsidere\s+(as\s+)?(instru[cç][oõ]es|regras)/i,
  /a\s+partir\s+de\s+agora\s+voc[eê]/i,
  /you\s+are\s+now\s+(an?\s+|the\s+)?(admin|developer|root|system|dan)/i,
  /act\s+as\s+(an?\s+|the\s+)?(admin|developer|root|system)/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /finja\s+que\s+voc[eê]/i,
  /^\s*(system|assistant|developer)\s*[:\]]/i,
  /\[(system|assistant|developer|admin)\]/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?)/i,
  /reveal\s+(your|the)\s+system\s+prompt/i,
  /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /me\s+mostre\s+(o\s+)?prompt/i,
  /me\s+(diga|envie)\s+(seu|o\s+seu)\s+(system\s+)?prompt/i,
  /quais?\s+(s[aã]o|[eé])\s+(as\s+)?suas\s+instru[cç][oõ]es/i,
  /override\s+(the\s+)?system\s+(prompt|instructions?)/i,
  /new\s+instructions?:/i,
  /nova\s+instru[cç][aã]o:/i,
  /dan\s*mode|developer\s*mode|god\s*mode|jailbreak/i,
  /(api|secret|access)\s*(key|token)|chave\s+(secreta|de\s+api)/i,
  /give\s+me\s+(admin|root)\s+access|me\s+d[eê]\s+acesso\s+(admin|root)/i,
  /base64|decode\s+this|decodifique/i,
  /\\x[0-9a-f]{2}/i,
  /%[0-9a-f]{2}/i,
  /\b(drop|truncate)\s+(table|database)\b/i,
  /\bunion\s+select\b.*\bfrom\b/i,
  /or[^a-z0-9]*1[^a-z0-9]*=[^a-z0-9]*1/i,
  /\binsert\s+into\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /[^\w\s\u00c0-\u017f]{30,}/,
  /([a-z])\1{12,}/i,
];

export type CommandClassification =
  | { readonly ok: false; readonly reason: "empty" | "too_long" | "unsafe" }
  | {
      readonly ok: true;
      readonly command: string;
      readonly intent: CommandIntent;
      readonly action: CommandAction;
    };

export function normalizeCommand(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMAND_LENGTH);
}

export function classifyCommand(raw: unknown): CommandClassification {
  const command = normalizeCommand(raw);
  if (!command) return { ok: false, reason: "empty" };
  if (String(raw).length > MAX_COMMAND_LENGTH)
    return { ok: false, reason: "too_long" };
  if (
    PROHIBITED_PATTERNS.some((pattern) =>
      pattern.test(normalizeForPolicy(command)),
    )
  ) {
    return { ok: false, reason: "unsafe" };
  }
  return {
    ok: true,
    command,
    intent: detectIntent(command),
    action: detectAction(command),
  };
}

function normalizeForPolicy(command: string): string {
  return command
    .replace(/\bi[\s._-]+g[\s._-]+n[\s._-]+o[\s._-]+r[\s._-]+e\b/gi, "ignore")
    .replace(
      /\be[\s._-]+s[\s._-]+q[\s._-]+u[\s._-]+e[\s._-]+c[\s._-]+a\b/gi,
      "esqueca",
    );
}

export function detectIntent(command: string): CommandIntent {
  const lower = command.toLocaleLowerCase("pt-BR");
  if (/caixa|reserva|liquidez|60 dias|capital de giro/.test(lower))
    return "cash";
  if (
    /fraude|suspeit|golpe|anomalia|risco.+(transa[cç]|pagamento|movimenta[cç])/.test(
      lower,
    )
  )
    return "fraud";
  if (/imposto|tribut|fiscal|simples nacional|\b(o|guia do) das\b/.test(lower))
    return "tax";
  if (
    /\b(pix|pagamentos?|pague|fornecedores?|transfira|transferir|transfer[eê]ncia)\b/.test(
      lower,
    )
  ) {
    return "payment";
  }
  if (/audit|trilha|evid[eê]ncia|conformidade/.test(lower)) return "audit";
  return "general";
}

export function detectAction(command: string): CommandAction {
  const lower = command.toLocaleLowerCase("pt-BR");
  if (
    /(altere|mude|configure|atualize).+(pol[ií]tica|regra|limite)/.test(lower)
  )
    return "change_policy";
  if (/\b(bloqueie|congele|suspenda|cancele)\b/.test(lower)) return "block";
  if (/\b(proje[cç][aã]o|projete|calcule|simule|estime)\b/.test(lower))
    return "simulate";
  if (/\b(fa[cç]a|pague|transfira|separe|envie|execute|aprove)\b/.test(lower))
    return "execute";
  if (/\b(prepare|preparar|monte|planeje|organize|proteja)\b/.test(lower))
    return "prepare";
  return "read";
}

export function requiresApproval(
  intent: CommandIntent,
  action: CommandAction,
): boolean {
  if (action === "change_policy" || action === "block") return true;
  if (intent === "payment" && action === "prepare") return true;
  return action === "execute" && ["payment", "cash", "tax"].includes(intent);
}

export function buildPlan(
  intent: CommandIntent,
  action: CommandAction,
): CommandPlan {
  const plan = PLANS[intent];
  const approvalRequired = requiresApproval(intent, action);
  return {
    agent: plan.agent,
    approvalRequired,
    message: approvalRequired ? plan.controlled : plan.safe,
  };
}

const PLANS: Record<
  CommandIntent,
  { agent: string; safe: string; controlled: string }
> = {
  fraud: {
    agent: "Agente de Risco",
    safe: "Este cenário demonstra revisão de risco. Consulte os movimentos e as aprovações; não há detecção de fraude em contas reais.",
    controlled:
      "Preparei uma decisão demonstrativa de bloqueio e aguardo sua aprovação. Nenhuma conta real será afetada.",
  },
  tax: {
    agent: "Agente Fiscal",
    safe: "O cenário fiscal usa valores fictícios e não calcula tributos de uma empresa real. Confira o valor antes de preparar a simulação.",
    controlled:
      "Preparei uma simulação de pagamento de tributos. Confira o valor da aprovação.",
  },
  payment: {
    agent: "Agente de Pagamentos",
    safe: "Consulte os pagamentos e favorecidos fictícios no cockpit. Para simular uma transferência, informe o valor em reais.",
    controlled:
      "Validei o pedido. Qualquer saída de dinheiro precisa da sua aprovação.",
  },
  cash: {
    agent: "Agente de Caixa",
    safe: "A projeção e a reserva exibidas pertencem ao cenário fictício. Nenhuma conta externa foi consultada.",
    controlled:
      "Preparei a separação de uma reserva fictícia e aguardo sua aprovação.",
  },
  audit: {
    agent: "Agente de Auditoria",
    safe: "Abra Auditoria para verificar a integridade da trilha desta sessão e exportar os registros.",
    controlled: "A exportação controlada foi preparada e aguarda aprovação.",
  },
  general: {
    agent: "Orquestrador",
    safe: "Reconheço comandos demonstrativos de caixa, Pix, tributos, risco e auditoria. Informe uma dessas ações para continuar.",
    controlled:
      "A mudança de política foi preparada e aguarda aprovação do responsável.",
  },
};

export function injectionRuleCount(): number {
  return PROHIBITED_PATTERNS.length;
}
