import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/postgres.integration.ts"], testTimeout: 15_000 },
});
