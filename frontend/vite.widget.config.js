import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: { entry: "src/widget/entry.js", formats: ["iife"], name: "McZenWidget", fileName: () => "widget.js" },
    minify: true,
  },
});
