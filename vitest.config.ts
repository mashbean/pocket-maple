import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.spec.ts"] },
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { MAX_TESTIMONIES: "5", LY_API_ORIGIN: "https://ly.test" } } })],
});
