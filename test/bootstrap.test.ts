import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapAgentDir, renderMcpJson } from "../src/bootstrap.js";
import type { LetradoEnv } from "../src/env.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "letrado-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("bootstrapAgentDir", () => {
  it("copia los recursos en el primer arranque", () => {
    const agentDir = join(tmp(), "agent");
    const env: LetradoEnv = { agentDir };
    const r = bootstrapAgentDir(env);
    expect(r.firstRun).toBe(true);
    for (const f of [
      "settings.json",
      "SYSTEM.md",
      "APPEND_SYSTEM.md",
      "mcp.json",
      "themes/letrado-dark.json",
      "themes/letrado-light.json",
      "skills/plazos-procesales/SKILL.md",
      "prompts/dictamen.md",
      ".letrado-resources-version",
      "managed-manifest.json",
    ]) {
      expect(existsSync(join(agentDir, f)), f).toBe(true);
    }
    // Sin ruta de MCP: servidor deshabilitado y aviso.
    const mcp = JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.fuentes.enabled).toBe(false);
    expect(r.notices.some((n) => n.includes("no configurado"))).toBe(true);
  });

  it("no sobrescribe settings.json ni mcp.json del usuario y respeta SYSTEM.md sin cambio de versión", () => {
    const agentDir = join(tmp(), "agent");
    const env: LetradoEnv = {
      agentDir,
      mcpCommand: "node",
      mcpArgs: ["/x/dist/index.js"],
      mcpEnvFile: "/x/.env",
    };
    bootstrapAgentDir(env);
    writeFileSync(join(agentDir, "settings.json"), '{"theme":"mio"}');
    writeFileSync(join(agentDir, "SYSTEM.md"), "editado por el usuario");
    const r = bootstrapAgentDir(env);
    expect(r.firstRun).toBe(false);
    expect(readFileSync(join(agentDir, "settings.json"), "utf8")).toBe('{"theme":"mio"}');
    expect(readFileSync(join(agentDir, "SYSTEM.md"), "utf8")).toBe("editado por el usuario");
    const mcp = JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.fuentes.enabled).toBe(true);
    expect(mcp.mcpServers.fuentes.args).toEqual(["/x/dist/index.js"]);
    expect(mcp.mcpServers.fuentes.env.MAITE_MCP_ENV_FILE).toBe("/x/.env");
  });

  it("actualiza SYSTEM.md con copia de seguridad cuando cambia la versión", () => {
    const agentDir = join(tmp(), "agent");
    const env: LetradoEnv = { agentDir };
    bootstrapAgentDir(env);
    writeFileSync(join(agentDir, "SYSTEM.md"), "editado por el usuario");
    writeFileSync(join(agentDir, ".letrado-resources-version"), "0.0.1\n");
    const r = bootstrapAgentDir(env);
    expect(r.backedUp.length).toBe(1);
    expect(existsSync(join(agentDir, "SYSTEM.md.bak-0.0.1"))).toBe(true);
    expect(readFileSync(join(agentDir, "SYSTEM.md"), "utf8")).toContain("Eres letrado");
  });
});

describe("renderMcpJson", () => {
  it("produce JSON válido con los valores del entorno", () => {
    const json = JSON.parse(
      renderMcpJson({ agentDir: "/a", mcpCommand: "npx", mcpArgs: ["-y", "servidor-mcp"] }),
    );
    expect(json.mcpServers.fuentes.command).toBe("npx");
    expect(json.mcpServers.fuentes.exposure).toBe("direct");
    expect(json.mcpServers.fuentes.timeout).toBe(300);
  });
});
