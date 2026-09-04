(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.BankCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MAX_COMMAND_LENGTH = 240;
  var PROHIBITED = [
    /ignore\s+(previous|prior|above)\s+(instructions?|rules?)/i,
    /esque[cç]a\s+(as\s+)?instru[cç][oõ]es/i,
    /reveal\s+(your|the)\s+system\s+prompt/i,
    /me\s+mostre\s+(o\s+)?prompt/i,
    /\b(drop|truncate)\s+(table|database)\b/i,
    /union\s+select/i,
    /(.)\1{12,}/
  ];

  function normalizeCommand(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_COMMAND_LENGTH);
  }

  function classifyCommand(raw) {
    var command = normalizeCommand(raw);
    if (!command) return { ok: false, reason: "empty" };
    if (String(raw).length > MAX_COMMAND_LENGTH) return { ok: false, reason: "too_long" };
    if (PROHIBITED.some(function (pattern) { return pattern.test(command); })) return { ok: false, reason: "unsafe" };
    return { ok: true, command: command, intent: detectIntent(command) };
  }

  function detectIntent(command) {
    var lower = command.toLocaleLowerCase("pt-BR");
    if (/fraude|suspeit|risco|golpe/.test(lower)) return "fraud";
    if (/imposto|tribut|fiscal|das\b/.test(lower)) return "tax";
    if (/pague|pagamento|pix|transf/.test(lower)) return "payment";
    if (/caixa|reserva|60 dias|capital/.test(lower)) return "cash";
    return "general";
  }

  function buildPlan(intent) {
    var plans = {
      fraud: { agent: "Agente de Risco", approval: false, message: "Analisei 128 lançamentos. Duas transações pedem revisão, ambas abaixo de R$ 1.000. Nenhum bloqueio foi aplicado." },
      tax: { agent: "Agente Fiscal", approval: false, message: "Projetei R$ 24.680 em tributos para o mês. A reserva atual cobre 121% da estimativa." },
      payment: { agent: "Agente de Pagamentos", approval: true, message: "Preparei o lote solicitado. Por segurança, qualquer saída de dinheiro precisa da sua aprovação." },
      cash: { agent: "Agente de Caixa", approval: true, message: "A reserva de 60 dias pede R$ 42.000. Preparei a separação do valor e aguardo sua aprovação." },
      general: { agent: "Orquestrador", approval: false, message: "Transformei o pedido em uma análise. Para executar, preciso do objetivo, prazo e limite de risco." }
    };
    return plans[intent] || plans.general;
  }

  function createApproval(intent, now) {
    var payment = intent === "payment";
    return {
      id: "approval-" + String(now),
      label: payment ? "PAGAMENTO PREPARADO" : "RESERVA SUGERIDA",
      title: payment ? "Lote de fornecedores, R$ 18.420" : "Separar R$ 42.000 para reserva",
      detail: payment ? "12 pagamentos validados. A saída só ocorre após aprovação humana." : "Mantém 60 dias de operação sem depender de novas entradas."
    };
  }

  function formatBrl(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
  }

  return {
    MAX_COMMAND_LENGTH: MAX_COMMAND_LENGTH,
    normalizeCommand: normalizeCommand,
    classifyCommand: classifyCommand,
    buildPlan: buildPlan,
    createApproval: createApproval,
    formatBrl: formatBrl
  };
});
