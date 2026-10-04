import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harvestFromToolResult } from "../../src/lib/citations/harvest.js";

const text = readFileSync(new URL("../fixtures/research-result-mcp.txt", import.meta.url), "utf8");

describe("harvest sobre la salida real de `research` del servidor MCP", () => {
  const r = harvestFromToolResult("mcp__fuentes__research", [{ type: "text", text }], undefined);

  it("cosecha las URL del BOE y de las normas modificadoras/derogatorias", () => {
    expect(r.allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404")).toBe(true);
    expect(r.allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2015-10727")).toBe(true);
    expect(r.allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-1881-813")).toBe(true);
  });

  it("cosecha Roj y ECLI de la sentencia sin URL", () => {
    expect(r.allowed.rojs.has("STS 1234:2025")).toBe(true);
    expect(r.allowed.eclis.has("ES:TS:2025:1234")).toBe(true);
  });

  it("lista como servidos también los documentos sin Enlace", () => {
    const labels = r.served.map((s) => s.label);
    expect(r.served.length).toBe(6);
    expect(labels.some((l) => l.startsWith("Tribunal Supremo. Sala de lo Civil"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Resolución TEAC"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Guía práctica"))).toBe(true);
    const sts = r.served.find((s) => s.roj === "STS 1234:2025");
    expect(sts?.ecli).toBe("ES:TS:2025:1234");
    expect(sts?.url).toBeUndefined();
    const lec = r.served.find((s) => s.url?.endsWith("#a404"));
    expect(lec?.vigencia).toContain("modificado");
  });
});
