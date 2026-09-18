// PORQUÊ: empacota o MVP do Sites. Somente HTML, CSS, SVG, JS e JPG públicos entram
// no bundle. Nenhum banco local, segredo, sessão ou node_modules é publicado.
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(".");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
};

interface StaticAsset {
  content: string;
  mime: string;
  binary: boolean;
}

async function collectText(
  relativeDir: string,
): Promise<Record<string, StaticAsset>> {
  const assets: Record<string, StaticAsset> = {};
  const absolute = join(root, relativeDir);
  if (!existsSync(absolute)) return assets;
  const files = await readdir(absolute, {
    recursive: true,
    withFileTypes: true,
  });
  for (const file of files) {
    if (!file.isFile() || !mime[extname(file.name)]) continue;
    const filename = join(file.parentPath, file.name);
    const local = relative(root, filename).replaceAll("\\", "/");
    const data = await readFile(filename);
    const extension = extname(file.name);
    assets[`/${local}`] = {
      content:
        extension === ".jpg" ? data.toString("base64") : data.toString("utf8"),
      mime: mime[extension]!,
      binary: extension === ".jpg",
    };
  }
  return assets;
}

const assets: Record<string, StaticAsset> = {};
for (const name of ["index.html", "app.html", "icon.svg"]) {
  const data = await readFile(join(root, name));
  const extension = extname(name);
  assets[`/${name}`] = {
    content:
      extension === ".jpg" ? data.toString("base64") : data.toString("utf8"),
    mime: mime[extension]!,
    binary: extension === ".jpg",
  };
}
Object.assign(assets, await collectText("styles"));
Object.assign(assets, await collectText("assets"));
const cockpit = await readFile(join(root, "dist", "web", "cockpit.js"), "utf8");
assets["/scripts/cockpit.js"] = {
  content: cockpit,
  mime: mime[".js"]!,
  binary: false,
};

await mkdir("dist/sites/server", { recursive: true });
await mkdir("dist/sites/client", { recursive: true });
await mkdir("dist/sites/.openai", { recursive: true });
await build({
  entryPoints: ["sites/worker.ts"],
  outfile: "dist/sites/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { STATIC_FILES: JSON.stringify(assets) },
});
if (existsSync(join(root, ".openai", "hosting.json"))) {
  await cp(
    join(root, ".openai", "hosting.json"),
    join(root, "dist", "sites", ".openai", "hosting.json"),
  );
}
await cp(
  join(root, "drizzle"),
  join(root, "dist", "sites", ".openai", "drizzle"),
  { recursive: true },
);
await writeFile(
  join(root, "dist", "sites", "server", "wrangler.json"),
  `${JSON.stringify(
    {
      name: "banco-aifirst",
      main: "index.js",
      compatibility_date: "2026-09-18",
      compatibility_flags: [],
      d1_databases: [
        {
          binding: "DB",
          database_name: "site-creator-d1",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
      assets: {
        directory: "../client",
        binding: "ASSETS",
        run_worker_first: true,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    event: "sites_build_complete",
    assets: Object.keys(assets).length,
  }),
);
