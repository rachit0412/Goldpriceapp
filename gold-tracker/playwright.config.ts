import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.TEST_URL || "http://127.0.0.1:3081", trace: "retain-on-failure" },
  reporter: "list",
});