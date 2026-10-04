#!/usr/bin/env node
// Launcher de `letrado`. Debe ejecutarse ANTES de importar pi-coding-agent:
// la configuración de Pi lee estas variables al resolver el directorio del agente.
import { homedir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR ??= process.env.LETRADO_HOME
  ? join(process.env.LETRADO_HOME, "agent")
  : join(homedir(), ".letrado", "agent");
process.env.PI_SKIP_VERSION_CHECK ??= "1";
process.env.PI_TELEMETRY ??= "0";

await import("../dist/cli.js");
