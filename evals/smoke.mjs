// PORQUE: smoke deterministico sem LLM. 5 casos: render, links, form, performance, acessibilidade.
// Falha vira caso em evals/cases.json (dataset evolutivo).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "index.html");
const casesPath = join(root, "evals", "cases.json");

function loadHtml() {
  return readFileSync(htmlPath, "utf8");
}

const results = [];
function check(id, name, fn) {
  const start = Date.now();
  try {
    const detail = fn();
    results.push({ id, name, pass: true, ms: Date.now() - start, detail });
  } catch (e) {
    results.push({ id, name, pass: false, ms: Date.now() - start, detail: String(e?.message ?? e) });
  }
}

const html = loadHtml();

// 1 render
check("render", "render: doctype, title, description, hero", () => {
  if (!html.includes("<!DOCTYPE html>")) throw new Error("sem doctype");
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
  if (title.length < 10) throw new Error("title curto ausente");
  if (!html.includes('name="description"')) throw new Error("sem meta description");
  if (!html.includes('class="hro')) throw new Error("sem hero");
  return `title=${title.slice(0, 60)} bytes=${Buffer.byteLength(html)}`;
});

// 2 links
check("links", "links: internos resolvem, wa.me presente, sem http quebrado", () => {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  if (!hrefs.some((h) => h.includes("wa.me/"))) throw new Error("sem link wa.me");
  const bad = hrefs.filter((h) => h.startsWith("http://"));
  if (bad.length > 0) throw new Error("link http inseguro: " + bad[0]);
  for (const s of srcs) {
    if (s.startsWith("http")) continue;
    if (s.startsWith("#") || s.startsWith("data:")) continue;
    const local = join(root, s.split("?")[0]);
    if (!existsSync(local)) throw new Error("asset ausente: " + s);
  }
  return `hrefs=${hrefs.length} srcs=${srcs.length}`;
});

// 3 form
check("form", "form: existe, campos required, submit gera wa.me", () => {
  if (!html.includes("<form")) throw new Error("sem form");
  if (!html.includes("required")) throw new Error("sem campo required");
  if (!html.includes('id="fm"')) throw new Error("sem form fm");
  if (!html.includes("encodeURIComponent") || !html.includes("wa.me/")) throw new Error("submit nao monta wa.me");
  return "form fm com required e wa.me ok";
});

// 4 performance
check("performance", "performance: html < 150KB, hero com fetchpriority, resto lazy", () => {
  const bytes = statSync(htmlPath).size;
  if (bytes > 150 * 1024) throw new Error("html pesado: " + bytes);
  if (!html.includes("fetchpriority")) throw new Error("hero sem fetchpriority");
  const imgs = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
  const nonLazy = imgs.filter((t) => !t.includes("loading=") && !t.includes("fetchpriority") && !/logo/i.test(t));
  if (nonLazy.length > 0) throw new Error("img sem loading lazy: " + nonLazy.length);
  return `bytes=${bytes} imgs=${imgs.length}`;
});

// 5 acessibilidade
check("a11y", "acessibilidade: lang, alt em imgs, labels, aria", () => {
  if (!html.includes('lang="pt-BR"')) throw new Error("sem lang pt-BR");
  const imgs = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
  const semAlt = imgs.filter((t) => !t.includes("alt="));
  if (semAlt.length > 0) throw new Error("img sem alt: " + semAlt.length);
  if (!html.includes("<label")) throw new Error("form sem label");
  if (!html.includes("aria-label")) throw new Error("sem aria-label");
  return `imgs=${imgs.length} ok`;
});

const passed = results.filter((r) => r.pass).length;
console.log(JSON.stringify({ passed, total: results.length, results }, null, 2));

// Falha vira caso no dataset
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  let dataset = [];
  try { dataset = JSON.parse(readFileSync(casesPath, "utf8")); } catch { dataset = []; }
  let changed = false;
  for (const f of failed) {
    if (!dataset.some((d) => d.id === f.id && d.detail === f.detail)) {
      dataset.push({ id: f.id, name: f.name, detail: f.detail, addedAt: new Date().toISOString().slice(0, 10) });
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dirname(casesPath), { recursive: true });
    writeFileSync(casesPath, JSON.stringify(dataset, null, 2));
    console.log("falhas registradas em evals/cases.json");
  }
  process.exit(1);
}
console.log(`SMOKE PASS ${passed}/${results.length}`);
