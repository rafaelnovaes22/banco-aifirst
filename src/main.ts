import Fastify from "fastify";
import {
  createAppContext,
  resolveBaasProviderFromEnv,
  registerAllRoutes,
} from "./app-context.js";
import { seedDemoContext } from "./demo-seed.js";

// PORQUÊ: entrypoint fino. Toda decisão vive nos módulos; aqui só monta,
// registra e escuta. Segredo do webhook vem de env, nunca hardcoded.

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_SECRET =
  process.env.BAAS_WEBHOOK_SECRET ?? "dev-secret-change-me";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const context = createAppContext(
    WEBHOOK_SECRET,
    resolveBaasProviderFromEnv(),
  );
  if (process.env.SEED_DEMO === "true") {
    // PORQUÊ: seed só com flag explícita. Em produção a flag nunca é setada.
    await seedDemoContext(context, new Date().toISOString());
    app.log.warn(
      "SEED_DEMO ativo: dados fictícios carregados, uso exclusivo para demonstração",
    );
  }
  await registerAllRoutes(app, context, process.env);
  await app.listen({ port: PORT, host: "0.0.0.0" });
}

void main();
