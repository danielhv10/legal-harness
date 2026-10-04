import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del paquete `letrado` (funciona desde src/ con tsx y desde dist/ compilado). */
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/version.ts -> ../ ; dist/cli.js -> ../
  return join(here, "..");
}

export function letradoVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function resourcesDir(): string {
  return join(packageRoot(), "resources");
}
