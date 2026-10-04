import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  // Keep every dependency external: we only strip TypeScript, we do not bundle.
  external: [/^@earendil-works\//, "typebox", "unpdf", "mammoth", "docx", "marked", "linkedom", "@mozilla/readability", "node-html-markdown"],
});
