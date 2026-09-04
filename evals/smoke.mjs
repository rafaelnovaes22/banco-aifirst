// PORQUÊ: valida o artefato servido e a composição de produção sem depender de rede.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const landing = read("index.html");
const cockpit = read("app.html");
const styles = [
  "styles/app.css",
  "styles/app-foundation.css",
  "styles/app-cockpit.css",
  "styles/app-sections.css",
]
  .map(read)
  .join("\n");
const server = read("src/runtime/server.ts");
const api = read("src/runtime/api-routes.ts");
const dockerfile = read("Dockerfile");
const railway = read("railway.json");
const results = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

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

check("cockpit", () => {
  expect(cockpit.includes('id="command-form"'), "comando AI ausente");
  expect(cockpit.includes('id="approval-list"'), "fila HITL ausente");
  expect(cockpit.includes('id="audit-list"'), "auditoria ausente");
  expect(
    cockpit.includes('src="/scripts/cockpit.js"'),
    "integração compilada ausente",
  );
});

check("assets", () => {
  const refs = localReferences(`${landing}\n${cockpit}`);
  for (const reference of refs) {
    const relative =
      reference === "/scripts/cockpit.js"
        ? "dist/web/cockpit.js"
        : reference.replace(/^\//, "");
    expect(existsSync(join(root, relative)), `arquivo ausente: ${reference}`);
  }
});

check("performance", () => {
  expect(
    statSync(join(root, "index.html")).size < 90 * 1_024,
    "landing acima de 90 KB",
  );
  expect(
    statSync(join(root, "app.html")).size < 70 * 1_024,
    "cockpit acima de 70 KB",
  );
  expect(
    statSync(join(root, "dist/web/cockpit.js")).size < 80 * 1_024,
    "script acima de 80 KB",
  );
});

check("accessibility", () => {
  expect(
    landing.includes('lang="pt-BR"') && cockpit.includes('lang="pt-BR"'),
    "idioma ausente",
  );
  expect(cockpit.includes('aria-live="polite"'), "feedback acessível ausente");
  expect(cockpit.includes('for="command-input"'), "label do comando ausente");
  expect(
    styles.includes("prefers-reduced-motion"),
    "movimento reduzido ausente",
  );
});

check("runtime-security", () => {
  expect(server.includes("Content-Security-Policy"), "CSP ausente");
  expect(server.includes("X-Frame-Options"), "proteção contra frame ausente");
  expect(api.includes("x-csrf-token"), "CSRF ausente");
  expect(api.includes("idempotency-key"), "idempotência ausente");
  expect(
    /não\s+movimenta\s+dinheiro/.test(cockpit),
    "limite do sandbox ausente",
  );
});

check("deployment", () => {
  expect(
    dockerfile.includes("FROM node:22-alpine AS build"),
    "build Node ausente",
  );
  expect(
    dockerfile.includes("COPY --from=build /app/dist/ ./dist/"),
    "runtime compilado fora da imagem",
  );
  expect(
    dockerfile.includes('CMD ["node", "dist/main.js"]'),
    "comando de produção ausente",
  );
  expect(
    railway.includes('"healthcheckPath": "/health"'),
    "healthcheck Railway ausente",
  );
});

function localReferences(html) {
  return [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => reference && !/^(https?:|mailto:)/.test(reference));
}

const failed = results.filter((result) => !result.pass);
console.log(
  JSON.stringify(
    { passed: results.length - failed.length, total: results.length, results },
    null,
    2,
  ),
);
if (failed.length) process.exit(1);
