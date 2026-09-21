// PORQUÊ: Worker não tem node:crypto. WebCrypto é o único hash disponível no bundle.
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
  );
  return `{${pairs.join(",")}}`;
}

export function identifier(bytes = 12): string {
  const sample = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(sample, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
