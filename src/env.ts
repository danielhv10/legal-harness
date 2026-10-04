import { homedir } from "node:os";
import { join } from "node:path";

export interface LetradoEnv {
  /** Directorio de configuración del agente (= PI_CODING_AGENT_DIR). */
  agentDir: string;
  /** Comando y argumentos para lanzar el servidor MCP de fuentes jurídicas, si se conocen. */
  mcpCommand?: string;
  mcpArgs?: string[];
  mcpEnvFile?: string;
  /** Proveedor de búsqueda web forzado por el usuario. */
  webSearchProvider?: string;
}

/**
 * Resuelve el entorno y fija los valores por defecto que Pi necesita.
 * Idempotente: si `bin/letrado.js` ya los fijó, los respeta.
 */
export function resolveEnv(env: NodeJS.ProcessEnv = process.env): LetradoEnv {
  const home = env.LETRADO_HOME;
  const agentDir =
    env.PI_CODING_AGENT_DIR ?? (home ? join(home, "agent") : join(homedir(), ".letrado", "agent"));
  env.PI_CODING_AGENT_DIR = agentDir;
  env.PI_SKIP_VERSION_CHECK ??= "1";
  env.PI_TELEMETRY ??= "0";

  const mcpArgs = env.LETRADO_MCP_ARGS?.split(/\s+/).filter(Boolean);
  return {
    agentDir,
    mcpCommand: env.LETRADO_MCP_COMMAND ?? (mcpArgs?.length ? "node" : undefined),
    mcpArgs,
    mcpEnvFile: env.LETRADO_MCP_ENV_FILE,
    webSearchProvider: env.LETRADO_WEB_SEARCH,
  };
}
