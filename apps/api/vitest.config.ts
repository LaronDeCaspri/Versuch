import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://dev:dev@127.0.0.1:5432/compliance_test?schema=public",
      SESSION_SECRET: "test-secret-test-secret-test-secret-0123",
      NODE_ENV: "test",
      STORAGE_DRIVER: "local",
      STORAGE_DIR: "/tmp/claude-0/-home-user-Versuch/7c8a6098-a0c3-526b-8f95-3d24bc9f6539/scratchpad/test-storage",
      CHROMIUM_EXECUTABLE: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
});
