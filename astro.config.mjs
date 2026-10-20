// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	site: "https://example.com",
	integrations: [sitemap()],
	// Sessions are unused; disabling them stops the adapter from adding a SESSION KV binding.
	session: false,
	adapter: cloudflare({
		imageService: "compile",
		prerenderEnvironment: "node",
	}),
});
