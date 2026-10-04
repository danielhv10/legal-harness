import { bootstrapAgentDir } from "./bootstrap.js";
import { resolveEnv } from "./env.js";

// 1. Entorno (PI_CODING_AGENT_DIR, etc.) ANTES de importar Pi.
const env = resolveEnv();
// 2. Preparar ~/.letrado/agent (settings, SYSTEM.md, temas, skills, prompts, mcp.json).
const bootstrap = bootstrapAgentDir(env);
for (const notice of bootstrap.notices) console.error(`letrado: ${notice}`);

// 3. Arrancar el CLI completo de Pi con nuestras extensiones inline.
const { main } = await import("@earendil-works/pi-coding-agent");
const { extensionFactories } = await import("./extensions/index.js");
await main(process.argv.slice(2), { extensionFactories });
