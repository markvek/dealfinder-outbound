import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:55211",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 55211",
    url: "http://127.0.0.1:55211",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    timeout: 60000,
    env: {
      NEXT_DIST_DIR: ".next-test",
      DEALFINDER_DB_PATH: `.context/test-data/${Date.now()}.sqlite`,
      DEALFINDER_CONNECTION_ORIGINS: "http://127.0.0.1:55212",
    },
  },
});
