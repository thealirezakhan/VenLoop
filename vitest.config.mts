import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, ".env.local"));
} catch {
  // No local env file (e.g. CI) — DB-backed suites skip when env is absent.
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
