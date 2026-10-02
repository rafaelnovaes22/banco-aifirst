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

let ultimoRelatorio: ShadowResponse | null = null;

const SAMPLE_CSV = [
  "id;data;descricao;valor;direcao",
  "m1;2026-09-01;TED cliente Alfa;1.500,00;IN",
  "m2;2026-09-02;Pix cliente Beta;200,00;IN",
  "m3;2026-09-03;Tarifa manutencao;10,00;OUT",
  "m4;2026-09-04;TED fornecedor Gama;800,00;OUT",
  "m5;2026-09-05;Pix cliente Delta;350,00;IN",
  "m6;2026-09-06;Boleto energia;180,00;OUT",
  "m7;2026-09-08;TED cliente Epsilon;2.200,00;IN",
  "m8;2026-09-09;Pix reembolso;95,50;IN",
].join("\n");

const SAMPLE_COMPROVANTES = JSON.stringify(
  [
    { amountInCents: 150000, occurredOn: "2026-09-01" },
    { amountInCents: 20000, occurredOn: "2026-09-02" },
    { amountInCents: 35000, occurredOn: "2026-09-05" },
    { amountInCents: 220000, occurredOn: "2026-09-08" },
    { amountInCents: 9550, occurredOn: "2026-09-09" },
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
  byId<HTMLInputElement>("shadow-csv-file").disabled = busy;
  byId<HTMLInputElement>("shadow-json-file").disabled = busy;
  byId<HTMLButtonElement>("shadow-submit").disabled = busy;
  byId<HTMLButtonElement>("shadow-export").disabled =
    busy || ultimoRelatorio === null;
  byId<HTMLButtonElement>("shadow-submit").textContent = busy
    ? "Calculando..."
    : "Rodar piloto shadow";
}

// PORQUÊ: arquivo do cliente nunca sai do navegador sem passar pela mesma
// validação do backend. Limite de 20 mil caracteres espelha o shadowSchema.
async function readClientFile(file: File, what: string): Promise<string> {
  if (file.size > 100_000)
    throw new Error(`${what} grande demais: máximo 100 KB.`);
  const text = await file.text();
  if (!text.trim())
    throw new Error(`${what} vazio: escolha um arquivo válido.`);
  if (text.length > 20_000)
    throw new Error(`${what} grande demais: máximo 20 mil caracteres.`);
  return text;
}

async function fillFromFile(
  inputId: string,
  targetId: string,
  what: string,
): Promise<void> {
  const picker = byId<HTMLInputElement>(inputId);
  const file = picker.files?.[0];
  if (!file) return;
  setShadowBusy(true);
  try {
    byId<HTMLTextAreaElement>(targetId).value = await readClientFile(
      file,
      what,
    );
    showToast(`${what} carregado. Confira e rode o piloto.`);
  } catch (error) {
    renderShadowFailure(error instanceof Error ? error.message : String(error));
  } finally {
    picker.value = "";
    setShadowBusy(false);
  }
}

function renderShadowResult(result: ShadowResponse): void {
  ultimoRelatorio = result;
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
  byId<HTMLButtonElement>("shadow-export").disabled = false;
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

// PORQUÊ: o cliente leva o número para casa. CSV com ponto e vírgula abre
// direto no Excel BR; BOM garante acento. Célula com =+-@ ganha apóstrofo.
function celulaCsv(valor: string | number): string {
  const texto = String(valor);
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

function relatorioCsv(result: ShadowResponse): string {
  const resumo = [
    "secao;metrica;valor",
    `resumo;total_extrato;${result.totalExtrato}`,
    `resumo;baixas_automaticas;${result.unicas}`,
    `resumo;ambiguas_para_humano;${result.ambiguas}`,
    `resumo;sem_match;${result.semMatch}`,
    `resumo;taxa_auto_baixa_pct;${(result.taxaAutoBaixa * 100).toFixed(1)}`,
    `resumo;horas_economizadas_mes;${result.horasEconomizadasMes.toFixed(0)}`,
    `resumo;economia_mensal_centavos;${result.economiaMensalEmCentavos}`,
    "",
    "secao;categoria;entradas_centavos;saidas_centavos",
    ...result.linhasDre.map(
      (linha) =>
        `dre;${celulaCsv(linha.categoria)};${linha.entradasEmCentavos};${linha.saidasEmCentavos}`,
    ),
  ];
  return `\uFEFF${resumo.join("\n")}`;
}

function exportarCsv(): void {
  if (!ultimoRelatorio) {
    renderShadowFailure("Rode o piloto shadow antes de exportar.");
    return;
  }
  const blob = new Blob([relatorioCsv(ultimoRelatorio)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "piloto-shadow.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Relatório CSV exportado.");
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
  byId("shadow-csv-file").addEventListener("change", () => {
    void fillFromFile("shadow-csv-file", "shadow-csv", "Extrato");
  });
  byId("shadow-json-file").addEventListener("change", () => {
    void fillFromFile(
      "shadow-json-file",
      "shadow-comprovantes",
      "Comprovantes",
    );
  });
  byId("shadow-export").addEventListener("click", () => {
    exportarCsv();
  });
}

bindShadow();
