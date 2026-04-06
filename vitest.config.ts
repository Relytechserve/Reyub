import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/integration/load-env.ts"],
    include: [
      "tests/integration/**/*.integration.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
