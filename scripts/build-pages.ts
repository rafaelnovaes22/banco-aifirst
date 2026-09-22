// PORQUÊ: github.io serve arquivos estáticos. Este script monta dist/pages com
// landing, cockpit, estilos e dois scripts relativos: o shim local primeiro e
// o cockpit compilado depois. Nenhum segredo ou node_modules entra no pacote.
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".";
const OUT = join("dist", "pages");
const SCRIPTS = join(OUT, "scripts");

async function copyStatic(): Promise<void> {
  await mkdir(SCRIPTS, { recursive: true });
  for (const name of ["index.html", "icon.svg"]) {
    await cp(join(ROOT, name), join(OUT, name));
  }
  await cp(join(ROOT, "app.html"), join(OUT, "app.html"));
  for (const dir of ["styles", "assets"]) {
    if (existsSync(join(ROOT, dir))) {
      await cp(join(ROOT, dir), join(OUT, dir), { recursive: true });
    }
  }
  await cp(join(ROOT, "dist", "web", "cockpit.js"), join(SCRIPTS, "cockpit.js"));
}

async function patchAppHtml(): Promise<void> {
  const path = join(OUT, "app.html");
  const html = await readFile(path, "utf8");
  const original = '<script type="module" src="/scripts/cockpit.js"></script>';
  if (!html.includes(original)) {
    throw new Error("app.html sem tag do cockpit; esperado script absoluto.");
  }
  const patched =
    '<script src="./scripts/pages-shim.js"></script>\n    <script type="module" src="./scripts/cockpit.js"></script>';
  await writeFile(path, html.replace(original, patched));
}

async function bundleShim(): Promise<void> {
  await build({
    entryPoints: ["sites/pages-shim.ts"],
    outfile: join(SCRIPTS, "pages-shim.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
  });
}

async function countFiles(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

await copyStatic();
await bundleShim();
await patchAppHtml();
await writeFile(join(OUT, ".nojekyll"), "");
console.log(JSON.stringify({ event: "pages_build_complete", files: await countFiles(OUT) }));
