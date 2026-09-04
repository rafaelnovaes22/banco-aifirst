// PORQUE: guardrails frontend para site estatico com assistente mock (sem LLM real).
// 3 frentes: sanitizacao + limites, bloqueio injection deterministico, validacao de form.
// Assistente demonstrativo: nunca alega LLM real.
(function () {
  "use strict";
  var MAX_INPUT = 500;
  var MAX_FORM_NAME = 80;
  var RATE_LIMIT_N = 5;
  var RATE_LIMIT_MS = 60 * 1000;
  var hits = [];
  function now() { return Date.now(); }
  function sanitizeInput(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_INPUT);
  }
  // 34 padroes PT-BR/EN: bloqueio deterministico, sem rede, sem LLM.
  var PATTERNS = [
    "ignore_instructions_en", "ignore_instructions_pt", "disregard_rules_pt",
    "esqueca_instrucoes_pt", "role_manipulation_en", "role_manipulation_pt",
    "act_as_dev_en", "from_now_on_pt", "dan_mode", "system_prefix",
    "bracket_system", "show_prompt_en", "show_prompt_pt", "qual_instrucao_pt",
    "quais_instrucoes_pt", "prompt_extraction_en", "override_system_en",
    "new_instructions", "forget_everything", "reveal_system_en",
    "revele_sistema_pt", "pretend_to_be", "secret_extraction", "admin_access",
    "base64_obfuscation", "hex_escape", "url_encoding", "sql_drop",
    "sql_union", "sql_or_injection", "sql_insert", "sql_update_set",
    "excessive_special_chars", "char_flooding"
  ];
  var REGEXES = [
    /ignore\s+(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
    /esque[cç]a\s+(as\s+)?instru[cç][oõ]es/i,
    /desconsidere\s+(as\s+)?regras/i,
    /esque[cç]a\s+tudo/i,
    /you\s+are\s+now\s+(an?\s+|the\s+)?(admin|developer|root|system|dan)/i,
    /voc[eê] agora [eé]/i,
    /act\s+as\s+(a\s+|an\s+)?(developer|admin|root|system)/i,
    /a\s+partir\s+de\s+agora\s+voc[eê]/i,
    /dan\s*mode|developer\s*mode|god\s*mode|jailbreak/i,
    /^\s*(system|assistant)\s*[:\]]\s*/i,
    /\[(system|assistant|admin)\]/i,
    /show\s+(me\s+)?(your|the)\s+(prompt|instructions?|system\s*prompt)/i,
    /me\s+(diga|mostre|envie)\s+(seu|o\s+seu)\s+(system\s+)?prompt/i,
    /qual\s+[eé]\s+a\s+sua\s+instru[cç][aã]o/i,
    /quais\s+s[aã]o\s+(as\s+)?suas\s+instru[cç][oõ]es/i,
    /what\s+(is|are)\s+your\s+(system\s+)?(instructions?|rules?|guidelines?)/i,
    /override\s+(system|the\s+system|your)\s+(prompt|instructions?)/i,
    /new\s+instructions?:|nova\s+instru[cç][aã]o:/i,
    /forget\s+everything|esque[cç]a\s+tudo/i,
    /reveal\s+(your|the)\s+system\s+(prompt|message)/i,
    /revele\s+(seu|o\s+seu)\s+(prompt|sistema)|mostre\s+o\s+sistema/i,
    /pretend\s+(to\s+be|you\s+are)|finja\s+que\s+voc[eê]/i,
    /what\s+(is|are)\s+(your|the)\s+(api|secret|access)\s+(key|token)/i,
    /give\s+me\s+(admin|root|access)|me\s+d[eê]\s+(acesso|admin)/i,
    /base64|decode\s+this|decodifique/i,
    /\\x[0-9a-f]{2}/i,
    /%[0-9a-f]{2}/i,
    /\b(drop|delete|truncate)\b\s+(table|from|database)/i,
    /union\s+select/i,
    /or[^a-z]*1[^a-z]*=[^a-z]*1/i,
    /\binsert\s+into\b/i,
    /update\s+\w+\s+set\b/i,
    /[^\w\s\u00C0-\u017F]{30,}/,
    /(.)\1{10,}/
  ];
  function detectInjection(text) {
    var found = [];
    for (var i = 0; i < REGEXES.length; i++) {
      try { if (REGEXES[i].test(text)) found.push(PATTERNS[i]); } catch (e) {}
    }
    return found;
  }
  function logJson(event) {
    try {
      var line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), area: "guardrails" }, event));
      if (typeof console !== "undefined" && console.log) console.log(line);
      return line;
    } catch (e) { return ""; }
  }
  function checkRate() {
    var t = now();
    hits = hits.filter(function (x) { return t - x < RATE_LIMIT_MS; });
    if (hits.length >= RATE_LIMIT_N) return false;
    hits.push(t);
    return true;
  }
  function validateInput(raw) {
    var text = sanitizeInput(raw);
    if (!text) return { ok: false, reason: "empty_message" };
    if (String(raw).length > MAX_INPUT) return { ok: false, reason: "message_too_long" };
    var found = detectInjection(text);
    if (found.length > 0) {
      logJson({ event: "injection_blocked", patterns: found });
      return { ok: false, reason: "prompt_injection_detected", patterns: found };
    }
    if (!checkRate()) return { ok: false, reason: "rate_limited" };
    return { ok: true, sanitized: text };
  }
  function validateForm(name, extra) {
    var n = sanitizeInput(name);
    if (!n || n.length < 2) return { ok: false, reason: "nome_obrigatorio" };
    if (n.length > MAX_FORM_NAME) return { ok: false, reason: "nome_muito_longo" };
    var found = detectInjection(n + " " + sanitizeInput(extra || ""));
    if (found.length > 0) {
      logJson({ event: "injection_blocked", where: "form", patterns: found });
      return { ok: false, reason: "prompt_injection_detected", patterns: found };
    }
    return { ok: true, sanitized: n };
  }
  var api = { sanitizeInput: sanitizeInput, detectInjection: detectInjection, validateInput: validateInput, validateForm: validateForm, PATTERNS: PATTERNS, MAX_INPUT: MAX_INPUT, DISCLAIMER: "Assistente demonstrativo (sem LLM real). Respostas de base local." };
  if (typeof window !== "undefined") window.Guardrails = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
