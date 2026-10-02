import { readFileSync } from "node:fs";
import { CsvExtratoProvider } from "../b2b/extrato-provider.js";
import { parsePilotoArgs } from "../b2b/piloto-args.js";
import { executarPilotoShadow } from "../b2b/piloto-shadow.js";
import {
  parseReceiptExtraction,
  type ReceiptExtraction,
} from "../domain/receipt-extraction.js";

// PORQUÊ: piloto shadow prova economia sem tocar em dinheiro. Este roteiro
// lê CSV do core mais comprovantes opcionais e imprime relatório em JSON.
// Roda com `npm run piloto:shadow -- demo-data-extrato.csv`.

function loadComprovantes(path: string | null): readonly ReceiptExtraction[] {
  if (path === null) return [];
  const raw = readJsonFile(path);
  if (!Array.isArray(raw))
    throw new Error(
      `comprovantes inválidos: recebido de ${path}, esperado array JSON`,
    );
  return raw.map((item, index) => parseComprovante(item, path, index));
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`comprovantes ilegíveis: ${path} não abriu como JSON`);
  }
}

function parseComprovante(
  item: unknown,
  path: string,
  index: number,
): ReceiptExtraction {
  const parsed = parseReceiptExtraction(item);
  if (!parsed.ok)
    throw new Error(
      `comprovante ${index} em ${path} rejeitado: ${parsed.failureReason}`,
    );
  return parsed.extraction;
}

function readCsvFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `extrato ilegível: ${path} não abriu, esperado CSV com id;data;descricao;valor;direcao`,
    );
  }
}

async function main(): Promise<void> {
  const config = parsePilotoArgs(process.argv.slice(2));
  const csv = readCsvFile(config.extratoPath);
  const provider = new CsvExtratoProvider(csv);
  const comprovantes = loadComprovantes(config.comprovantesPath);
  const relatorio = await executarPilotoShadow(
    provider,
    comprovantes,
    config.premissas,
    config.nomeOrgao,
  );
  const totalExtrato = (await provider.listarMovimentos()).length;
  console.log(
    JSON.stringify(
      { extratoPath: config.extratoPath, totalExtrato, ...relatorio },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ event: "piloto_shadow_failed", error: message })}\n`,
  );
  process.exitCode = 1;
});
