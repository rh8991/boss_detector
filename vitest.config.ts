import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          HOOK_TOKEN: "test-hook-token",
          ALLOWED_ORIGINS: "https://pages.example",
        },
      },
    }),
  ],
});
