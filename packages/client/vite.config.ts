import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// `base` matters for GitHub Pages, which serves from /<repo>/. Override at build
// time with VITE_BASE (e.g. "/padel/"); defaults to "/" for local dev.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  resolve: {
    alias: {
      "@padel/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
});
