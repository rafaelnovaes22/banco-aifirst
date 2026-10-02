// PORQUÊ: a vista de conciliação reaproveita sessão, POST e toast do cockpit.
// O cálculo roda no backend da sessão (Pages) ou no Fastify; o navegador só
// renderiza o relatório em leitura, sem tocar em dinheiro.
import {
  failureMessage,
  moneyFormatter,
  mutateJson,
  showToast,
  textElement,
} from "./cockpit.js";

interface ShadowLinha {
  readonly categoria: string;
  readonly entradasEmCentavos: number;
  readonly saidasEmCentavos: number;
}

interface ShadowResponse {
  readonly totalExtrato: number;
  readonly unicas: number;
  readonly ambiguas: number;
  readonly semMatch: number;
  readonly taxaAutoBaixa: number;
  readonly horasEconomizadasMes: number;
  readonly economiaMensalEmCentavos: number;
  readonly textoResumoDre: string;
  readonly linhasDre: readonly ShadowLinha[];
}

const SAMPLE_CSV = [
  "id;data;descricao;valor;direcao",
  "m1;2026-09-01;TED cliente Alfa;1.500,00;IN",
  "m2;2026-09-02;Pix cliente Beta;200,00;IN",
  "m3;2026-09-03;Tarifa manutencao;10,00;OUT",
  "m4;2026-09-04;TED fornecedor Gama;800,00;OUT",
].join("\n");

const SAMPLE_COMPROVANTES = JSON.stringify(
  [
    { amountInCents: 150000, occurredOn: "2026-09-01" },
    { amountInCents: 20000, occurredOn: "2026-09-02" },
  ],
  null,
  2,
);

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento ausente: ${id}; esperado ID existente`);
  return found as T;
}

function setShadowBusy(busy: boolean): void {
  byId<HTMLTextAreaElement>("shadow-csv").disabled = busy;
  byId<HTMLTextAreaElement>("shadow-comprovantes").disabled = busy;
  byId<HTMLButtonElement>("shadow-submit").disabled = busy;
  byId<HTMLButtonElement>("shadow-submit").textContent = busy
    ? "Calculando..."
    : "Rodar piloto shadow";
}

function renderShadowResult(result: ShadowResponse): void {
  const taxa = `${(result.taxaAutoBaixa * 100).toFixed(1)}%`;
  const economia = moneyFormatter.format(result.economiaMensalEmCentavos / 100);
  const linhas = result.linhasDre
    .map(
      (linha) =>
        `${linha.categoria}: +${moneyFormatter.format(linha.entradasEmCentavos / 100)} / -${moneyFormatter.format(linha.saidasEmCentavos / 100)}`,
    )
    .join("; ");
  const panel = byId("shadow-result");
  panel.classList.toggle("is-error", false);
  panel.replaceChildren(
    textElement("span", "PILOTO SHADOW", "response-label"),
    textElement(
      "p",
      `${result.unicas} de ${result.totalExtrato} baixas automáticas (${taxa}). ${result.ambiguas} ambíguas sobem para humano.`,
    ),
    textElement(
      "p",
      `Economia estimada: ${result.horasEconomizadasMes.toFixed(0)}h/mês, ${economia}/mês.`,
    ),
    textElement("p", result.textoResumoDre),
    textElement("p", linhas || "Sem linhas de DRE."),
  );
}

function renderShadowFailure(message: string): void {
  const panel = byId("shadow-result");
  panel.classList.toggle("is-error", true);
  panel.replaceChildren(
    textElement("span", "PILOTO SHADOW", "response-label"),
    textElement("p", message),
  );
}

function parseComprovantes(raw: string): unknown[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("not-array");
    return parsed as unknown[];
  } catch {
    throw new Error("Comprovantes em JSON inválido: esperado array.");
  }
}

async function submitShadow(): Promise<void> {
  const csv = byId<HTMLTextAreaElement>("shadow-csv").value.trim();
  if (!csv) {
    renderShadowFailure("Cole o CSV do extrato antes de rodar.");
    return;
  }
  let comprovantes: unknown[] | undefined;
  try {
    comprovantes = parseComprovantes(
      byId<HTMLTextAreaElement>("shadow-comprovantes").value,
    );
  } catch (error) {
    renderShadowFailure(error instanceof Error ? error.message : String(error));
    return;
  }
  setShadowBusy(true);
  try {
    const body: Record<string, unknown> = { csv };
    if (comprovantes) body["comprovantes"] = comprovantes;
    const result = await mutateJson<ShadowResponse>("/api/v1/b2b-shadow", body);
    renderShadowResult(result);
    showToast("Piloto shadow calculado e auditado.");
  } catch (error) {
    renderShadowFailure(failureMessage(error));
  } finally {
    setShadowBusy(false);
  }
}

function bindShadow(): void {
  byId("shadow-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitShadow();
  });
  byId("shadow-sample").addEventListener("click", () => {
    byId<HTMLTextAreaElement>("shadow-csv").value = SAMPLE_CSV;
    byId<HTMLTextAreaElement>("shadow-comprovantes").value =
      SAMPLE_COMPROVANTES;
  });
}

bindShadow();
