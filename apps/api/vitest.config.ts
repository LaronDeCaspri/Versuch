import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://dev:dev@127.0.0.1:5432/compliance_test?schema=public",
      SESSION_SECRET: "test-secret-test-secret-test-secret-0123",
      NODE_ENV: "test",
    },
  },
});
