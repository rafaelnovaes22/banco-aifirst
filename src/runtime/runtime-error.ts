export class RuntimeError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function conflict(code: string, message: string): RuntimeError {
  return new RuntimeError(409, code, message);
}

export function unprocessable(code: string, message: string): RuntimeError {
  return new RuntimeError(422, code, message);
}
