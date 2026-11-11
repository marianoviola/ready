import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: false
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: false
  }),
  copyFile("public/manifest.json", "dist/manifest.json")
]);
