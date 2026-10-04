import { describe, expect, it } from "vitest";
import {
  BRAILLE_FRAMES,
  contextBar,
  contextLevel,
  DEFAULT_WORKING_MESSAGE,
  workingMessageFor,
} from "../src/lib/ui-format.js";

describe("contextBar", () => {
  it("rellena 10 celdas proporcionalmente", () => {
    expect(contextBar(0)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(contextBar(30)).toBe("▰▰▰▱▱▱▱▱▱▱");
    expect(contextBar(55)).toBe("▰▰▰▰▰▰▱▱▱▱");
    expect(contextBar(100)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });
  it("acota valores fuera de rango y no numéricos", () => {
    expect(contextBar(-20)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(contextBar(250)).toBe("▰▰▰▰▰▰▰▰▰▰");
    expect(contextBar(Number.NaN)).toBe("▱▱▱▱▱▱▱▱▱▱");
  });
  it("admite otro número de celdas", () => {
    expect(contextBar(50, 4)).toBe("▰▰▱▱");
    expect(contextBar(50, 4)).toHaveLength(4);
  });
});

describe("contextLevel", () => {
  it("verde por debajo del 60 %, aviso por debajo del 85 %, error después", () => {
    expect(contextLevel(0)).toBe("success");
    expect(contextLevel(59.9)).toBe("success");
    expect(contextLevel(60)).toBe("warning");
    expect(contextLevel(84.9)).toBe("warning");
    expect(contextLevel(85)).toBe("error");
    expect(contextLevel(100)).toBe("error");
  });
});

describe("workingMessageFor", () => {
  it("asigna verbos a las herramientas de fuentes jurídicas", () => {
    expect(workingMessageFor("mcp__fuentes__research")).toBe("Investigando en las fuentes jurídicas…");
    expect(workingMessageFor("mcp__fuentes__search_legal")).toBe("Buscando legislación y jurisprudencia…");
    expect(workingMessageFor("mcp__fuentes__get_document")).toBe("Leyendo el documento completo…");
    expect(workingMessageFor("mcp__fuentes__otra")).toBe("Consultando las fuentes jurídicas…");
  });
  it("asigna verbos a las herramientas locales", () => {
    expect(workingMessageFor("read_pdf")).toBe("Leyendo el PDF…");
    expect(workingMessageFor("read_docx")).toBe("Leyendo el documento Word…");
    expect(workingMessageFor("write_docx")).toBe("Redactando el documento Word…");
    expect(workingMessageFor("web_search")).toBe("Buscando en la web…");
    expect(workingMessageFor("web_fetch")).toBe("Leyendo la página web…");
    expect(workingMessageFor("bash")).toBe("Ejecutando un comando…");
    for (const t of ["read", "grep", "find", "ls"])
      expect(workingMessageFor(t)).toBe("Revisando el expediente…");
    for (const t of ["edit", "write"]) expect(workingMessageFor(t)).toBe("Editando el fichero…");
  });
  it("vuelve al mensaje por defecto para herramientas desconocidas", () => {
    expect(workingMessageFor("desconocida")).toBe(DEFAULT_WORKING_MESSAGE);
    expect(DEFAULT_WORKING_MESSAGE).toBe("Analizando…");
  });
});

describe("BRAILLE_FRAMES", () => {
  it("tiene fotogramas de una sola celda", () => {
    expect(BRAILLE_FRAMES.length).toBeGreaterThan(4);
    for (const f of BRAILLE_FRAMES) expect([...f]).toHaveLength(1);
  });
});
