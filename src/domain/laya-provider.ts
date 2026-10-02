// PORQUÊ: cópia vendored de Projetos/_shared/jev/laya-provider.ts.
// O build Docker copia só src/, então o import cruza a fronteira do repo.
// Fonte canônica fica no _shared; esta cópia só remove o import externo.
// Provider local System-1 (Laya, Jev-compatível): sem chave, sem rede,
// sem token por decisão. O pacote @receptron/laya entra por injeção
// (loader), então compila e testa sem baixar os pesos (1,7 GB).
// Calibração PT-BR pendente: opera somente em shadow.

export const LAYA_REVISION_PINNED = "main";
export const LAYA_DEFAULT_TIMEOUT_MS = 2000;
export const LAYA_MAX_STATE_CHARS = 2000;

export interface LayaLoadOptions {
  readonly revision?: string;
  readonly cacheDir?: string;
  readonly modelDir?: string;
}

export interface LayaRunner {
  systemOne(
    state: unknown,
    questions: Record<string, { type: string; instructions: string }>,
  ): Promise<{ answers: Record<string, unknown> }>;
  close(): Promise<void>;
}

export interface LayaLoader {
  load(options: LayaLoadOptions): Promise<LayaRunner>;
}

export interface LayaProviderConfig {
  readonly loader: LayaLoader;
  readonly revision?: string;
  readonly cacheDir?: string;
  readonly modelDir?: string;
  readonly timeoutMs?: number;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface LayaNoulPair {
  readonly wantsToClose: number;
  readonly wantsHandoff: number;
}

function sanitizeState(raw: string): string {
  if (!raw) return "";
  // PORQUÊ: filtro por codepoint em vez de classe regex com controles,
  // que o lint no-control-regex barra. Mesmo comportamento do sanitize
  // de jev-intent-check.ts.
  const clean = [...raw]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 32;
      return (code >= 32 && code < 127) || code >= 160;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= LAYA_MAX_STATE_CHARS) return clean;
  return clean.slice(0, LAYA_MAX_STATE_CHARS);
}

function toProb(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function parseNoul(
  answers: Record<string, unknown>,
  key: string,
): number | null {
  const entry = answers[key];
  if (!entry || typeof entry !== "object") return null;
  return toProb((entry as Record<string, unknown>)["noul"]);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function defaultLog(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      area: "jev",
      event,
      ...fields,
    }),
  );
}

export function createLayaProvider(config: LayaProviderConfig): {
  query(stateText: string): Promise<LayaNoulPair | null>;
  close(): Promise<void>;
} {
  const log = config.log ?? defaultLog;
  const timeoutMs = config.timeoutMs ?? LAYA_DEFAULT_TIMEOUT_MS;
  let runner: Promise<LayaRunner> | null = null;
  let unavailable = false;

  function ensureRunner(): Promise<LayaRunner> | null {
    if (unavailable) return null;
    if (!runner) {
      runner = config.loader
        .load({
          revision: config.revision ?? LAYA_REVISION_PINNED,
          cacheDir: config.cacheDir,
          modelDir: config.modelDir,
        })
        .catch((error: unknown) => {
          unavailable = true;
          runner = null;
          log("laya_unavailable", {
            mode: "shadow",
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });
    }
    return runner;
  }

  async function query(stateText: string): Promise<LayaNoulPair | null> {
    const loading = ensureRunner();
    if (!loading) return null;
    const state = sanitizeState(stateText);
    if (!state) return null;
    try {
      const ready = await loading;
      const out = await withTimeout(
        ready.systemOne(
          { text: state },
          {
            wantsToClose: {
              type: "noul",
              instructions:
                "The customer message states they want to close, sign, or buy now (explicit buying intent, not interest).",
            },
            wantsHandoff: {
              type: "noul",
              instructions:
                "The customer message asks to talk to a human attendant or salesperson (explicit handoff request).",
            },
          },
        ),
        timeoutMs,
      );
      if (!out) return null;
      const wantsToClose = parseNoul(out.answers, "wantsToClose");
      const wantsHandoff = parseNoul(out.answers, "wantsHandoff");
      if (wantsToClose === null || wantsHandoff === null) return null;
      return { wantsToClose, wantsHandoff };
    } catch {
      return null;
    }
  }

  async function close(): Promise<void> {
    if (!runner) return;
    try {
      await (await runner).close();
    } catch {
      return;
    } finally {
      runner = null;
    }
  }

  return { query, close };
}
