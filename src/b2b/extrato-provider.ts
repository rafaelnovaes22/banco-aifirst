// PORQUÊ: banco real não expõe BaaS parceiro. O ponto de troca é o extrato
// (CSV, CNAB simplificado ou API do core). Este port isola o Fluxo OS do core.
export interface B2bExtratoMovement {
  readonly id: string;
  readonly amountInCents: number;
  readonly direction: "IN" | "OUT";
  readonly occurredOn: string;
  readonly descricao: string;
}

export interface ExtratoProvider {
  listarMovimentos(): Promise<readonly B2bExtratoMovement[]>;
}

function parseValorParaCentavos(valor: string): number | null {
  const normalizado = valor.trim().replace(/\./g, "").replace(",", ".");
  const reais = Number.parseFloat(normalizado);
  if (!Number.isFinite(reais) || reais <= 0) return null;
  return Math.round(reais * 100);
}

function parseLinha(
  campos: readonly string[],
  numeroLinha: number,
): B2bExtratoMovement | null {
  if (campos.length < 4) return null;
  const id = campos[0]?.trim() ?? "";
  const data = campos[1]?.trim() ?? "";
  const descricao = campos[2]?.trim() ?? "";
  const valorRaw = campos[3]?.trim() ?? "";
  const direcaoRaw = (campos[4]?.trim() ?? "IN").toUpperCase();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !descricao) return null;
  const centavos = parseValorParaCentavos(valorRaw);
  if (centavos === null) return null;
  const direction = direcaoRaw === "OUT" ? "OUT" : "IN";
  void numeroLinha;
  return {
    id,
    amountInCents: centavos,
    direction,
    occurredOn: data,
    descricao,
  };
}

// PORQUÊ: CSV é o menor denominador comum entre cores bancários. CNAB e API
// do core viram adaptadores futuros sem tocar na conciliação.
export function parseCsvExtrato(csv: string): readonly B2bExtratoMovement[] {
  const saidas: B2bExtratoMovement[] = [];
  const linhas = csv.split("\n");
  linhas.forEach((linha, indice) => {
    const texto = linha.trim();
    if (!texto || texto.startsWith("id;") || texto.startsWith("id,")) return;
    const campos =
      texto.split(";").length >= 4 ? texto.split(";") : texto.split(",");
    const movimento = parseLinha(campos, indice + 1);
    if (movimento) saidas.push(movimento);
  });
  return saidas;
}

export class CsvExtratoProvider implements ExtratoProvider {
  private readonly csv: string;

  constructor(csv: string) {
    if (!csv.trim()) throw new Error("csv do extrato não pode ficar vazio");
    this.csv = csv;
  }

  async listarMovimentos(): Promise<readonly B2bExtratoMovement[]> {
    return parseCsvExtrato(this.csv);
  }
}

export class MemoriaExtratoProvider implements ExtratoProvider {
  private readonly movimentos: readonly B2bExtratoMovement[];

  constructor(movimentos: readonly B2bExtratoMovement[]) {
    this.movimentos = movimentos;
  }

  async listarMovimentos(): Promise<readonly B2bExtratoMovement[]> {
    return this.movimentos;
  }
}
