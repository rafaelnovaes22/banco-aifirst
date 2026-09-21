import { PostgresBankRepository } from "./runtime/postgres-repository.js";
import { buildBankServer } from "./runtime/server.js";

async function main(): Promise<void> {
  const databaseUrl = requireEnvironment("DATABASE_URL");
  const appOrigin = requireEnvironment("APP_ORIGIN");
  const repository = new PostgresBankRepository({ databaseUrl });
  try {
    await startRuntime(repository, appOrigin);
  } catch (error) {
    await repository.close().catch(() => undefined);
    throw error;
  }
}

async function startRuntime(
  repository: PostgresBankRepository,
  appOrigin: string,
): Promise<void> {
  await repository.initialize();
  const secureCookie = new URL(appOrigin).protocol === "https:";
  const app = await buildBankServer(repository, {
    appOrigin,
    cookieName: secureCookie ? "__Host-fluxo_session" : "fluxo_session",
    secureCookie,
    staticRoot: process.cwd(),
    logger: true,
  });
  registerShutdownSignals(app);
  await app.listen({ port: readPort(), host: "0.0.0.0" });
}

function requireEnvironment(name: "DATABASE_URL" | "APP_ORIGIN"): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `${name} ausente: o runtime falha fechado sem esta configuração.`,
    );
  return value;
}

function readPort(): number {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`PORT inválida: ${process.env.PORT}.`);
  return port;
}

function registerShutdownSignals(app: { close(): Promise<void> }): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void app.close());
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ event: "startup_failed", error: message })}\n`,
  );
  process.exitCode = 1;
});
