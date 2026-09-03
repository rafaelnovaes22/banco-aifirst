// PORQUE: ISO/IEC 42001 clausulas 6.1, 7.5, 8.1 em site estatico.
// 4 cheques deterministicos via tsx: risco, dados, PII, clausula.
// Falha com arquivo, problema e como corrigir.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Issue = { file: string; problem: string; fix: string };
const issues: Issue[] = [];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "index.html");
const riskPath = join(root, "governance", "risk-register.json");
const dataPath = join(root, "governance", "data-map.json");

function classify(level: number): string {
  if (level <= 4) return "baixo";
  if (level <= 9) return "medio";
  if (level <= 14) return "alto";
  return "critico";
}

// RISCO (clausula 6.1)
if (!existsSync(riskPath)) {
  issues.push({ file: "governance/risk-register.json", problem: "registro de riscos ausente", fix: "criar governance/risk-register.json com >=3 riscos" });
} else {
  const reg = JSON.parse(readFileSync(riskPath, "utf8")) as { risks: Array<{ id: string; probability: number; impact: number; level: number; classification: string; controls?: string[]; accepted_by?: string; accepted_at?: string; residual?: string }> };
  if (!Array.isArray(reg.risks) || reg.risks.length < 3) {
    issues.push({ file: "governance/risk-register.json", problem: "menos de 3 riscos", fix: "declarar >=3 riscos com probabilidade x impacto" });
  } else {
    for (const r of reg.risks) {
      const expected = r.probability * r.impact;
      if (r.level !== expected) issues.push({ file: "governance/risk-register.json", problem: `${r.id}: level ${r.level} != ${r.probability}x${r.impact}=${expected}`, fix: `corrigir level para ${expected}` });
      if (r.classification !== classify(r.level)) issues.push({ file: "governance/risk-register.json", problem: `${r.id}: classificacao ${r.classification} != ${classify(r.level)}`, fix: `usar ${classify(r.level)}` });
      for (const c of r.controls ?? []) {
        if (!existsSync(join(root, c))) issues.push({ file: "governance/risk-register.json", problem: `${r.id}: controle ${c} aponta para arquivo inexistente`, fix: "corrigir caminho ou remover" });
      }
      const residual = (r as { residual_classification?: string }).residual_classification ?? r.residual ?? r.classification;
      if (residual !== "baixo" && (!r.accepted_by || !r.accepted_at)) issues.push({ file: "governance/risk-register.json", problem: `${r.id}: residual ${residual} sem aceite`, fix: "registrar accepted_by e accepted_at" });
      if (residual === "critico") issues.push({ file: "governance/risk-register.json", problem: `${r.id}: residual CRITICO em aberto`, fix: "mitigar antes de producao" });
    }
  }
}

// DADOS (clausula 7.5: dado pessoal mapeado com finalidade e base)
if (!existsSync(dataPath)) {
  issues.push({ file: "governance/data-map.json", problem: "mapa de dados ausente", fix: "criar governance/data-map.json com campos, finalidade e base LGPD" });
} else {
  const map = JSON.parse(readFileSync(dataPath, "utf8")) as { personalData?: Array<{ field: string; purpose: string; basis: string }> };
  if (!Array.isArray(map.personalData) || map.personalData.length === 0) {
    issues.push({ file: "governance/data-map.json", problem: "nenhum dado pessoal mapeado", fix: "listar nome, whatsapp, data com finalidade" });
  } else {
    for (const d of map.personalData) {
      if (!d.field || !d.purpose || !d.basis) issues.push({ file: "governance/data-map.json", problem: `campo incompleto: ${JSON.stringify(d)}`, fix: "preencher field, purpose, basis" });
    }
  }
}

// PII (confronto codigo x declarado)
const html: string = readFileSync(htmlPath, "utf8");
{
  const hasWhatsapp = /wa\.me\/\d+/.test(html);
  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(html);
  const hasForm = /<form/i.test(html);
  const mapRaw: string = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : "";
  if (hasWhatsapp && !/whatsapp/i.test(mapRaw)) issues.push({ file: "governance/data-map.json", problem: "wa.me no codigo sem cobertura no mapa", fix: "mapear whatsapp com finalidade agendamento" });
  if (hasForm && !/nome/i.test(mapRaw)) issues.push({ file: "governance/data-map.json", problem: "form coleta nome sem mapeamento", fix: "mapear nome com base consentimento" });
  if (hasEmail && !/email/i.test(mapRaw)) issues.push({ file: "governance/data-map.json", problem: "email no codigo sem mapeamento", fix: "mapear email ou remover" });
  if (hasForm && !/WhatsApp/i.test(html)) issues.push({ file: "index.html", problem: "form sem aviso de destino WhatsApp", fix: "informar que envia para WhatsApp" });
}

// CLAUSULA (outcome verificavel: titulo, CTA, conversao whatsapp)
{
  if (!/<title>[^<]{10,}<\/title>/.test(html)) issues.push({ file: "index.html", problem: "title ausente ou curto", fix: "declarar outcome no title" });
  if (!/wa\.me\//.test(html)) issues.push({ file: "index.html", problem: "sem conversao whatsapp", fix: "adicionar CTA com wa.me" });
  const ctas: number = (html.match(/class="bt bt1"/g) ?? []).length;
  if (ctas === 0) issues.push({ file: "index.html", problem: "sem CTA primario", fix: "adicionar botao bt1" });
}

if (issues.length > 0) {
  console.log(JSON.stringify({ iso: "FAIL", issues }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ iso: "PASS", checks: ["risco", "dados", "PII", "clausula"] }));
