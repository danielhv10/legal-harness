import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { LetradoEnv } from "./env.js";
import { letradoVersion, resourcesDir } from "./version.js";

/** Ficheros que pertenecen al usuario: se crean si faltan y nunca se sobrescriben. */
const USER_OWNED = ["settings.json", "APPEND_SYSTEM.md"];
/** Ficheros/directorios gestionados por letrado: se actualizan cuando cambia la versión (con copia de seguridad). */
const MANAGED = ["SYSTEM.md", "themes", "skills", "prompts"];
/** Plantillas que no se copian al agent dir (se usan desde `resources/` al vuelo). */
const SKIP = new Set(["mcp.json.template", "EXPEDIENTE.md", "AGENTS.expediente.md"]);

const VERSION_FILE = ".letrado-resources-version";
const MANIFEST_FILE = "managed-manifest.json";

export interface BootstrapResult {
  firstRun: boolean;
  updated: string[];
  backedUp: string[];
  notices: string[];
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

function readVersion(agentDir: string): string | undefined {
  try {
    return readFileSync(join(agentDir, VERSION_FILE), "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Prepara `~/.letrado/agent` a partir de `resources/`.
 * Síncrono e idempotente: se ejecuta en cada arranque antes de que Pi lea la configuración.
 */
export function bootstrapAgentDir(env: LetradoEnv, resources = resourcesDir()): BootstrapResult {
  const agentDir = env.agentDir;
  const result: BootstrapResult = { firstRun: !existsSync(agentDir), updated: [], backedUp: [], notices: [] };
  mkdirSync(agentDir, { recursive: true });

  const version = letradoVersion();
  const installed = readVersion(agentDir);
  const versionChanged = installed !== version;

  for (const name of readdirSync(resources)) {
    if (SKIP.has(name)) continue;
    const src = join(resources, name);
    const dst = join(agentDir, name);

    if (USER_OWNED.includes(name)) {
      if (!existsSync(dst)) {
        cpSync(src, dst);
        result.updated.push(name);
      }
      continue;
    }

    if (MANAGED.includes(name)) {
      if (!existsSync(dst)) {
        cpSync(src, dst, { recursive: true });
        result.updated.push(name);
        continue;
      }
      if (!versionChanged) continue;
      // Actualización: copia de seguridad del fichero si el usuario pudo editarlo (solo SYSTEM.md).
      if (name === "SYSTEM.md" && readFileSync(src, "utf8") !== readFileSync(dst, "utf8")) {
        const bak = join(agentDir, `SYSTEM.md.bak-${installed ?? "previa"}`);
        renameSync(dst, bak);
        result.backedUp.push(bak);
        result.notices.push(`SYSTEM.md actualizado; la versión anterior se guardó en ${bak}`);
      }
      cpSync(src, dst, { recursive: true, force: true });
      result.updated.push(name);
    }
  }

  if (!existsSync(join(agentDir, "mcp.json"))) {
    writeFileSync(join(agentDir, "mcp.json"), renderMcpJson(env, resources));
    result.updated.push("mcp.json");
    if (!env.mcpArgs?.length) {
      result.notices.push(
        "Servidor de fuentes jurídicas no configurado. Ejecuta: letrado mcp add fuentes -- node /ruta/al/mcp/dist/index.js  (o define LETRADO_MCP_ARGS)",
      );
    }
  }

  if (versionChanged) {
    writeFileSync(join(agentDir, VERSION_FILE), `${version}\n`);
    const managedFiles = MANAGED.flatMap((m) => {
      const p = join(resources, m);
      if (!existsSync(p)) return [];
      return statSync(p).isDirectory() ? listFiles(p).map((f) => join(m, f)) : [m];
    });
    writeFileSync(
      join(agentDir, MANIFEST_FILE),
      `${JSON.stringify({ version, managed: managedFiles }, null, 2)}\n`,
    );
  }
  return result;
}

export function renderMcpJson(env: LetradoEnv, resources = resourcesDir()): string {
  const template = readFileSync(join(resources, "mcp.json.template"), "utf8");
  const enabled = Boolean(env.mcpArgs?.length);
  const mcpEnv: Record<string, string> = {};
  if (env.mcpEnvFile) mcpEnv.MAITE_MCP_ENV_FILE = env.mcpEnvFile;
  return template
    .replace("__MCP_COMMAND__", env.mcpCommand ?? "node")
    .replace("__MCP_ARGS__", JSON.stringify(env.mcpArgs ?? ["/ruta/al/servidor-mcp/dist/index.js"]))
    .replace("__MCP_ENV__", JSON.stringify(mcpEnv))
    .replace("__MCP_ENABLED__", String(enabled));
}
