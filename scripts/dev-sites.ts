// PORQUÊ: runtime local do Sites com Miniflare e D1 próprio. Porta 8003, sem
// conflitar com o demo do GeraBoleto nem com o Railway local.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: "dist/sites/server/index.js",
    compatibilityDate: "2026-09-18",
    host: "127.0.0.1",
    port: 8003,
    d1Databases: { DB: "banco-aifirst-local" },
    d1Persist: process.env["SITES_D1_PATH"] ?? ".cache/sites-banco-local",
    bindings: { PUBLIC_ORIGIN: "http://127.0.0.1:8003" },
  }),
);
const database = await runtime.getD1Database("DB");
const existing = await database
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='banco_sessions'",
  )
  .first();
if (!existing) {
  const migration = await readFile("drizzle/0000_banco.sql", "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    await database.prepare(statement).run();
  }
}
console.log(
  JSON.stringify({
    event: "sites_local_ready",
    url: String(await runtime.ready),
  }),
);
