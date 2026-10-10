import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    include: ["test/**/*.test.ts"],
  },
});
