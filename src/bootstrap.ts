import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { LetradoEnv } from "./env.js";
import { letradoVersion, resourcesDir } from "./version.js";

/** Ficheros que pertenecen al usuario: se crean si faltan y nunca se sobrescriben. */
const USER_OWNED = ["settings.json", "APPEND_SYSTEM.md"];
/**
 * Ficheros/directorios gestionados por letrado: se sincronizan por contenido. Si la fuente cambia,
 * se actualizan; si el usuario los había editado, se guarda copia de seguridad antes.
 */
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

interface Manifest {
  version: string;
  /** Ruta relativa → sha256 del contenido tal como lo instaló letrado. */
  hashes: Record<string, string>;
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

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readManifest(agentDir: string): Manifest {
  try {
    const parsed = JSON.parse(readFileSync(join(agentDir, MANIFEST_FILE), "utf8")) as Partial<Manifest>;
    return { version: parsed.version ?? "", hashes: parsed.hashes ?? {} };
  } catch {
    return { version: "", hashes: {} };
  }
}

/** Ficheros gestionados existentes en `resources/`, como rutas relativas. */
function managedFiles(resources: string): string[] {
  return MANAGED.flatMap((m) => {
    const p = join(resources, m);
    if (!existsSync(p)) return [];
    return statSync(p).isDirectory() ? listFiles(p).map((f) => join(m, f)) : [m];
  });
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
  const manifest = readManifest(agentDir);
  const nextHashes: Record<string, string> = {};

  for (const name of USER_OWNED) {
    const src = join(resources, name);
    const dst = join(agentDir, name);
    if (existsSync(src) && !existsSync(dst)) {
      cpSync(src, dst);
      result.updated.push(name);
    }
  }

  for (const rel of managedFiles(resources)) {
    if (SKIP.has(rel)) continue;
    const src = join(resources, rel);
    const dst = join(agentDir, rel);
    const srcBuf = readFileSync(src);
    const srcHash = sha256(srcBuf);
    nextHashes[rel] = srcHash;

    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, srcBuf);
      result.updated.push(rel);
      continue;
    }
    const dstHash = sha256(readFileSync(dst));
    if (dstHash === srcHash) continue;

    // El fichero instalado difiere de la fuente actual.
    const installedByLetrado = manifest.hashes[rel];
    // Si la fuente no ha cambiado desde que letrado lo instaló, la diferencia es una edición del usuario: se respeta.
    if (installedByLetrado === srcHash) continue;
    // La fuente ha cambiado. Si además el usuario lo editó, copia de seguridad antes de actualizar.
    const userEdited = installedByLetrado !== undefined ? dstHash !== installedByLetrado : true;
    if (userEdited) {
      const bak = `${dst}.bak-${manifest.version || "previa"}`;
      cpSync(dst, bak);
      result.backedUp.push(bak);
      result.notices.push(`${rel} actualizado; tu versión anterior se guardó en ${bak}`);
    }
    writeFileSync(dst, srcBuf);
    result.updated.push(rel);
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

  const manifestChanged =
    manifest.version !== version || JSON.stringify(manifest.hashes) !== JSON.stringify(nextHashes);
  if (manifestChanged) {
    writeFileSync(join(agentDir, VERSION_FILE), `${version}\n`);
    const next: Manifest = { version, hashes: nextHashes };
    writeFileSync(join(agentDir, MANIFEST_FILE), `${JSON.stringify(next, null, 2)}\n`);
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
