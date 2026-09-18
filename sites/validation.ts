// PORQUÊ: erro com status permite ao worker responder o envelope {error} sem try aninhado.
export class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function exactFields(
  input: Record<string, unknown>,
  allowed: string[],
  required: string[] = allowed,
): void {
  const unknownKeys = Object.keys(input).filter(
    (key) => !allowed.includes(key),
  );
  const missing = required.filter((key) => !(key in input));
  if (unknownKeys.length > 0 || missing.length > 0) {
    throw new HttpError(
      422,
      "Campos inválidos: confira os campos permitidos e obrigatórios.",
    );
  }
}

export function textField(
  input: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new HttpError(422, `Campo ${key} inválido: esperado texto.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw new HttpError(
      422,
      `Campo ${key} inválido: esperado entre ${minimum} e ${maximum} caracteres.`,
    );
  }
  return trimmed;
}

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function idempotencyKey(header: string | null): string {
  if (!header || !IDEMPOTENCY_PATTERN.test(header)) {
    throw new HttpError(
      400,
      "Envie uma chave idempotente válida para esta ação.",
    );
  }
  return header;
}

export function approvalId(value: string): string {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(value)) {
    throw new HttpError(400, "A aprovação informada não é válida.");
  }
  return value;
}
