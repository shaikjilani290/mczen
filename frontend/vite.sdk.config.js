import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/widget/sdk-entry.js",
      formats: ["iife"],
      name: "McZEN",
      fileName: () => "mczen-sdk.js",
    },
    minify: true,
  },
});
