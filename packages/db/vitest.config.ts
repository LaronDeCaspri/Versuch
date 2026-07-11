import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://dev:dev@127.0.0.1:5432/compliance_test?schema=public",
    },
  },
});
