// PORQUÊ: valida a demonstração inteira sem depender de rede ou LLM.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const landing = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "app.html"), "utf8");
const nginx = readFileSync(join(root, "nginx.conf"), "utf8");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const results = [];

function check(id, assertion) {
  try {
    assertion();
    results.push({ id, pass: true });
  } catch (error) {
    results.push({ id, pass: false, detail: String(error?.message ?? error) });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

check("landing", () => {
  expect(landing.includes("<!DOCTYPE html>"), "doctype ausente");
  expect(landing.includes("MVP DO BANCO AI FIRST"), "proposta ausente");
  expect(landing.includes('href="app.html"'), "CTA do cockpit ausente");
});

check("product", () => {
  expect(app.includes('id="command-form"'), "comando AI ausente");
  expect(app.includes('id="approval-list"'), "fila HITL ausente");
  expect(app.includes('id="audit-list"'), "auditoria ausente");
  expect(app.includes('id="view-governance"'), "governança ausente");
});

check("assets", () => {
  const refs = [...landing.matchAll(/(?:src|href)="([^"#]+)"/g), ...app.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]);
  const local = refs.filter((ref) => !/^(https?:|mailto:)/.test(ref));
  local.forEach((ref) => expect(existsSync(join(root, ref.split("?")[0])), "arquivo ausente: " + ref));
});

check("performance", () => {
  expect(statSync(join(root, "index.html")).size < 90 * 1024, "landing acima de 90KB");
  expect(statSync(join(root, "app.html")).size < 70 * 1024, "app acima de 70KB");
});

check("accessibility", () => {
  expect(landing.includes('lang="pt-BR"') && app.includes('lang="pt-BR"'), "idioma ausente");
  expect(app.includes('aria-live="polite"'), "feedback acessível ausente");
  expect(app.includes('for="command-input"'), "label do comando ausente");
  expect(readFileSync(join(root, "styles", "app.css"), "utf8").includes("prefers-reduced-motion"), "movimento reduzido ausente");
});

check("safety", () => {
  expect(landing.includes("não é instituição financeira"), "disclosure legal ausente");
  expect(app.includes("não movimenta dinheiro"), "escopo do MVP ausente");
  expect(nginx.includes("Content-Security-Policy"), "CSP ausente");
  expect(nginx.includes("X-Frame-Options"), "proteção de frame ausente");
});

check("deployment", () => {
  expect(nginx.includes("location = /health"), "healthcheck ausente");
  expect(dockerfile.includes("COPY app.html"), "cockpit fora da imagem");
  expect(dockerfile.includes("COPY scripts/"), "regras fora da imagem");
  expect(dockerfile.includes("COPY icon.svg"), "favicon fora da imagem");
});

const failed = results.filter((result) => !result.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2));
if (failed.length) process.exit(1);
