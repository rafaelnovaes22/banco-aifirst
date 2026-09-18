import { decideBankApproval, runBankCommand } from "./bank-engine.ts";
import type { BankRow, BankState, CommandResult } from "./types.ts";
import {
  approvalId,
  exactFields,
  idempotencyKey,
  textField,
} from "./validation.ts";
import { HttpError } from "./validation.ts";

// PORQUÊ: despacha as rotas /api/v1 do cockpit para o motor com o mesmo contrato.
export async function dispatchBankCommand(
  state: BankState,
  row: BankRow,
  path: string,
  input: Record<string, unknown>,
  key: string | null,
): Promise<CommandResult> {
  if (path === "/api/v1/commands") return commandRoute(state, row, input, key);
  const decision = /^\/api\/v1\/approvals\/([^/]+)\/decisions$/.exec(path);
  if (decision?.[1]) return decisionRoute(state, row, decision[1], input, key);
  throw new HttpError(404, "Operação não encontrada.");
}

function commandRoute(
  state: BankState,
  row: BankRow,
  input: Record<string, unknown>,
  key: string | null,
): CommandResult {
  exactFields(input, ["text"]);
  const text = textField(input, "text", 1, 1000);
  if (!key)
    throw new HttpError(
      400,
      "Envie uma chave idempotente válida para esta ação.",
    );
  const outcome = runBankCommand(state, row.actor_id, text, key, new Date());
  return { payload: outcome.value, events: outcome.audits };
}

function decisionRoute(
  state: BankState,
  row: BankRow,
  rawId: string,
  input: Record<string, unknown>,
  key: string | null,
): CommandResult {
  exactFields(input, ["decision", "expectedVersion"]);
  if (input["decision"] !== "APPROVE" && input["decision"] !== "REJECT") {
    throw new HttpError(422, "Decisão inválida: use APPROVE ou REJECT.");
  }
  if (
    typeof input["expectedVersion"] !== "number" ||
    !Number.isInteger(input["expectedVersion"])
  ) {
    throw new HttpError(422, "Versão esperada inválida.");
  }
  if (!key)
    throw new HttpError(
      400,
      "Envie uma chave idempotente válida para esta ação.",
    );
  const outcome = decideBankApproval(
    state,
    row.actor_id,
    approvalId(decodeURIComponent(rawId)),
    input["decision"],
    input["expectedVersion"],
    key,
    new Date(),
  );
  return {
    payload: outcome.value as unknown as Record<string, unknown>,
    events: outcome.audits,
  };
}

export function commandIdempotency(request: Request): string | null {
  return request.headers.get("idempotency-key");
}

export function requireCommandIdempotency(request: Request): string {
  return idempotencyKey(commandIdempotency(request));
}
