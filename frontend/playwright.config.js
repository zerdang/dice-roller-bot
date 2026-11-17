import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  workers: 2,
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5174", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI },
});
