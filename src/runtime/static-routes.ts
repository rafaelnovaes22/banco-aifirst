import { readFile, readdir } from "node:fs/promises";
import { extname, join, posix, resolve } from "node:path";

import type { FastifyInstance, FastifyReply } from "fastify";

interface StaticAsset {
  readonly body: Buffer;
  readonly contentType: string;
  readonly immutable: boolean;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

export async function registerStaticRoutes(
  app: FastifyInstance,
  rootDirectory: string,
): Promise<void> {
  const assets = await loadStaticAssets(rootDirectory);
  app.get("/", async (_request, reply) =>
    sendAsset(reply, requireAsset(assets, "/app.html")),
  );
  for (const [route, asset] of assets) {
    if (route === "/index.html") continue;
    app.get(route, async (_request, reply) => sendAsset(reply, asset));
  }
}

async function loadStaticAssets(
  rootDirectory: string,
): Promise<Map<string, StaticAsset>> {
  const root = resolve(rootDirectory);
  const assets = new Map<string, StaticAsset>();
  await addFile(assets, root, "index.html", false);
  await addFile(assets, root, "app.html", false);
  await addFile(assets, root, "icon.svg", true);
  await addDirectory(assets, root, "assets", true);
  await addDirectory(assets, root, "styles", false);
  await addDirectory(assets, root, "governance", false);
  await addFile(
    assets,
    root,
    join("dist", "web", "cockpit.js"),
    false,
    "/scripts/cockpit.js",
  );
  return assets;
}

async function addDirectory(
  assets: Map<string, StaticAsset>,
  root: string,
  relativeDirectory: string,
  immutable: boolean,
): Promise<void> {
  const entries = await readdir(join(root, relativeDirectory), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory())
      await addDirectory(assets, root, relativePath, immutable);
    else await addFile(assets, root, relativePath, immutable);
  }
}

async function addFile(
  assets: Map<string, StaticAsset>,
  root: string,
  relativePath: string,
  immutable: boolean,
  publicRoute?: string,
): Promise<void> {
  const contentType = CONTENT_TYPES[extname(relativePath).toLowerCase()];
  if (!contentType) return;
  const route = publicRoute ?? `/${relativePath.split("\\").join("/")}`;
  assets.set(posix.normalize(route), {
    body: await readFile(join(root, relativePath)),
    contentType,
    immutable,
  });
}

function requireAsset(
  assets: ReadonlyMap<string, StaticAsset>,
  route: string,
): StaticAsset {
  const asset = assets.get(route);
  if (!asset) throw new Error(`Ativo obrigatório ausente: ${route}`);
  return asset;
}

function sendAsset(reply: FastifyReply, asset: StaticAsset): FastifyReply {
  reply.type(asset.contentType);
  reply.header(
    "Cache-Control",
    asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
  );
  return reply.send(asset.body);
}
