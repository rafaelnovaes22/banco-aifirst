(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BankCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MAX_COMMAND_LENGTH = 240;
  var QUALITY_GATE = 0.95;
  var PROHIBITED = [
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
    /[^\w\s\u00C0-\u017F]{30,}/,
    /([a-z])\1{12,}/i
  ];

  function normalizeCommand(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_COMMAND_LENGTH);
  }

  function normalizeForPolicy(command) {
    return command
      .replace(/\bi[\s._-]+g[\s._-]+n[\s._-]+o[\s._-]+r[\s._-]+e\b/gi, "ignore")
      .replace(/\be[\s._-]+s[\s._-]+q[\s._-]+u[\s._-]+e[\s._-]+c[\s._-]+a\b/gi, "esqueca");
  }

  function classifyCommand(raw) {
    var command = normalizeCommand(raw);
    if (!command) return { ok: false, reason: "empty" };
    if (String(raw).length > MAX_COMMAND_LENGTH) return { ok: false, reason: "too_long" };
    var policyText = normalizeForPolicy(command);
    if (PROHIBITED.some(function (pattern) { return pattern.test(policyText); })) return { ok: false, reason: "unsafe" };
    return { ok: true, command: command, intent: detectIntent(command), action: detectAction(command) };
  }

  function detectIntent(command) {
    var lower = command.toLocaleLowerCase("pt-BR");
    if (/caixa|reserva|liquidez|60 dias|capital de giro/.test(lower)) return "cash";
    if (/fraude|suspeit|golpe|anomalia|risco.+(transa[cç]|pagamento|movimenta[cç])/.test(lower)) return "fraud";
    if (/imposto|tribut|fiscal|simples nacional|\b(o|guia do) das\b/.test(lower)) return "tax";
    if (/\b(pix|pagamentos?|pague|fornecedores?|transfira|transferir|transfer[eê]ncia)\b/.test(lower)) return "payment";
    if (/audit|trilha|evid[eê]ncia|conformidade/.test(lower)) return "audit";
    return "general";
  }

  function detectAction(command) {
    var lower = command.toLocaleLowerCase("pt-BR");
    if (/(altere|mude|configure|atualize).+(pol[ií]tica|regra|limite)/.test(lower)) return "change_policy";
    if (/\b(bloqueie|congele|suspenda|cancele)\b/.test(lower)) return "block";
    if (/\b(proje[cç][aã]o|projete|calcule|simule|estime)\b/.test(lower)) return "simulate";
    if (/\b(fa[cç]a|pague|transfira|separe|envie|execute|aprove)\b/.test(lower)) return "execute";
    if (/\b(prepare|monte|planeje|organize|proteja)\b/.test(lower)) return "prepare";
    return "read";
  }

  function requiresApproval(intent, action) {
    if (action === "change_policy" || action === "block") return true;
    return action === "execute" && ["payment", "cash", "tax"].includes(intent);
  }

  function buildPlan(intent, action) {
    var plans = {
      fraud: { agent: "Agente de Risco", safe: "Analisei 128 lançamentos. Duas transações pedem revisão. Nenhum bloqueio foi aplicado.", controlled: "Preparei o bloqueio preventivo das transações suspeitas e aguardo sua aprovação." },
      tax: { agent: "Agente Fiscal", safe: "Projetei R$ 24.680 em tributos para o mês. A reserva atual cobre 121% da estimativa.", controlled: "Preparei o pagamento de R$ 24.680 em tributos e aguardo sua aprovação." },
      payment: { agent: "Agente de Pagamentos", safe: "Listei 12 pagamentos pendentes e validei favorecidos, datas e limites. Nenhuma saída foi executada.", controlled: "Validei o lote solicitado. Qualquer saída de dinheiro precisa da sua aprovação." },
      cash: { agent: "Agente de Caixa", safe: "Projetei a liquidez para 60 dias. A reserva recomendada é de R$ 42.000, sem movimentação automática.", controlled: "A separação de R$ 42.000 mantém 60 dias de operação e aguarda sua aprovação." },
      audit: { agent: "Agente de Auditoria", safe: "Conferi políticas, evidências e aprovações. A trilha está completa e pronta para exportação." },
      general: { agent: "Orquestrador", safe: "Transformei o pedido em uma análise. Para executar, preciso do objetivo, prazo e limite de risco.", controlled: "A mudança de política foi preparada e aguarda aprovação do responsável." }
    };
    var selected = plans[intent] || plans.general;
    var approval = requiresApproval(intent, action || "read");
    return { agent: selected.agent, approval: approval, message: approval ? selected.controlled : selected.safe };
  }

  function createApproval(intent, now) {
    var approvals = {
      payment: ["PAGAMENTO PREPARADO", "Lote de fornecedores, R$ 18.420", "12 pagamentos validados. A saída só ocorre após aprovação humana."],
      cash: ["RESERVA SUGERIDA", "Separar R$ 42.000 para reserva", "Mantém 60 dias de operação sem depender de novas entradas."],
      tax: ["TRIBUTO PREPARADO", "Pagar R$ 24.680 em tributos", "Guia e favorecido validados. O pagamento exige aprovação humana."],
      fraud: ["BLOQUEIO PREPARADO", "Bloquear duas transações suspeitas", "A medida preventiva só entra em vigor após aprovação humana."],
      general: ["POLÍTICA PREPARADA", "Alterar política operacional", "Mudanças de regra exigem aprovação do responsável."]
    };
    var selected = approvals[intent] || approvals.general;
    return {
      id: "approval-" + String(now),
      label: selected[0],
      title: selected[1],
      detail: selected[2]
    };
  }

  function formatBrl(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
  }

  return {
    MAX_COMMAND_LENGTH: MAX_COMMAND_LENGTH,
    QUALITY_GATE: QUALITY_GATE,
    INJECTION_RULE_COUNT: PROHIBITED.length,
    normalizeCommand: normalizeCommand,
    classifyCommand: classifyCommand,
    detectIntent: detectIntent,
    detectAction: detectAction,
    requiresApproval: requiresApproval,
    buildPlan: buildPlan,
    createApproval: createApproval,
    formatBrl: formatBrl
  };
});
