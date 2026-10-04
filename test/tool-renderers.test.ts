import { describe, expect, it } from "vitest";
import {
  countLines,
  countResults,
  describeCall,
  displayPath,
  editStats,
  firstLine,
  summarizeBash,
  summarizeEdit,
  summarizeError,
  summarizeRead,
  summarizeWrite,
} from "../src/lib/tool-summaries.js";

describe("summarizeRead", () => {
  it("cuenta líneas en castellano", () => {
    expect(summarizeRead("a\nb\nc")).toBe("3 líneas");
    expect(summarizeRead("una")).toBe("1 línea");
    expect(summarizeRead("")).toBe("0 líneas");
  });
  it("no cuenta el salto final como línea extra", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });
  it("indica el truncado con el total", () => {
    expect(summarizeRead("a\nb", { truncated: true, totalLines: 500 })).toBe("2 líneas de 500 (truncado)");
    expect(summarizeRead("a\nb", { truncated: true })).toBe("2 líneas (truncado)");
    expect(summarizeRead("a\nb", { truncated: false, totalLines: 2 })).toBe("2 líneas");
  });
});

describe("summarizeBash", () => {
  it("devuelve 'sin salida' cuando no hay texto", () => {
    expect(summarizeBash("")).toBe("sin salida");
    expect(summarizeBash("\n  \n")).toBe("sin salida");
  });
  it("muestra la primera línea no vacía y el total", () => {
    expect(summarizeBash("\nhola\nmundo\n")).toBe("hola … (2 líneas)");
    expect(summarizeBash("solo")).toBe("solo");
  });
  it("marca el truncado", () => {
    expect(summarizeBash("a\nb", { truncated: true })).toBe("a … (2 líneas) (truncado)");
  });
  it("recorta líneas muy largas", () => {
    const long = "x".repeat(200);
    expect(firstLine(long, 80).length).toBe(80);
    expect(firstLine(long, 80).endsWith("…")).toBe(true);
  });
});

describe("summarizeEdit", () => {
  const diff = [
    "--- a/demanda.md",
    "+++ b/demanda.md",
    "@@ -1,3 +1,4 @@",
    " contexto",
    "-vieja",
    "+nueva",
    "+otra",
    " fin",
  ].join("\n");
  it("cuenta añadidos y eliminados ignorando cabeceras", () => {
    expect(editStats(diff)).toEqual({ added: 2, removed: 1 });
    expect(summarizeEdit(diff)).toBe("+2 −1 líneas");
  });
  it("usa el parche si el diff está vacío", () => {
    expect(summarizeEdit("", diff)).toBe("+2 −1 líneas");
    expect(summarizeEdit(undefined, diff)).toBe("+2 −1 líneas");
  });
  it("informa de 'sin cambios' cuando no hay diferencias", () => {
    expect(summarizeEdit("", "")).toBe("sin cambios");
  });
});

describe("summarizeWrite", () => {
  it("cuenta las líneas escritas", () => {
    expect(summarizeWrite("a\nb\nc\n")).toBe("3 líneas escritas");
    expect(summarizeWrite("a")).toBe("1 línea escrita");
  });
});

describe("countResults", () => {
  it("cuenta líneas no vacías", () => {
    expect(countResults("a.pdf\nb.pdf\n\n")).toBe("2 resultados");
    expect(countResults("uno")).toBe("1 resultado");
  });
  it("detecta la ausencia de resultados", () => {
    expect(countResults("")).toBe("sin resultados");
    expect(countResults("No matches found")).toBe("sin resultados");
    expect(countResults("No files found")).toBe("sin resultados");
  });
  it("marca el truncado", () => {
    expect(countResults("a\nb", { truncated: true })).toBe("2 resultados (truncado)");
  });
});

describe("summarizeError", () => {
  it("no duplica el prefijo Error", () => {
    expect(summarizeError("Error: no existe el fichero\nmás")).toBe("Error: no existe el fichero");
    expect(summarizeError("ENOENT")).toBe("Error: ENOENT");
    expect(summarizeError("")).toBe("Error: error desconocido");
  });
});

describe("displayPath", () => {
  it("relativiza al cwd y abrevia el home", () => {
    expect(displayPath("/exp/caso/contrato.md", "/exp/caso")).toBe("contrato.md");
    expect(displayPath("/exp/caso", "/exp/caso")).toBe(".");
    expect(displayPath("/home/ana/otro.md", "/exp/caso", "/home/ana")).toBe("~/otro.md");
    expect(displayPath("relativo.md", "/exp/caso")).toBe("relativo.md");
  });
});

describe("describeCall", () => {
  const cwd = "/exp/caso";
  it("read con rango de líneas", () => {
    expect(describeCall("read", { path: "contrato.md", offset: 1, limit: 120 }, cwd)).toEqual({
      verb: "Leer",
      subject: "contrato.md",
      detail: "(líneas 1-120)",
    });
    expect(describeCall("read", { path: "contrato.md", offset: 40 }, cwd)?.detail).toBe(
      "(desde la línea 40)",
    );
    expect(describeCall("read", { path: "contrato.md", limit: 10 }, cwd)?.detail).toBe("(líneas 1-10)");
    expect(describeCall("read", { path: "contrato.md" }, cwd)?.detail).toBeUndefined();
  });
  it("bash con el comando entre acentos graves", () => {
    expect(describeCall("bash", { command: "ls -la\necho x" }, cwd)).toEqual({
      verb: "Ejecutar",
      subject: "`ls -la`",
    });
  });
  it("edit y write", () => {
    expect(describeCall("edit", { path: "/exp/caso/demanda.md", edits: [] }, cwd)).toEqual({
      verb: "Editar",
      subject: "demanda.md",
    });
    expect(describeCall("write", { path: "resumen.md", content: "a\nb" }, cwd)).toEqual({
      verb: "Escribir",
      subject: "resumen.md",
      detail: "(2 líneas)",
    });
  });
  it("grep, find y ls", () => {
    expect(describeCall("grep", { pattern: "plazo", path: "src" }, cwd)).toEqual({
      verb: "Buscar",
      subject: "«plazo»",
      detail: "en src/",
    });
    expect(describeCall("grep", { pattern: "plazo", glob: "*.md" }, cwd)?.detail).toBe("en ./ (*.md)");
    expect(describeCall("find", { pattern: "*.pdf" }, cwd)).toEqual({
      verb: "Buscar ficheros",
      subject: "*.pdf",
      detail: undefined,
    });
    expect(describeCall("find", { pattern: "*.pdf", path: "pruebas" }, cwd)?.detail).toBe("en pruebas/");
    expect(describeCall("ls", { path: "pruebas" }, cwd)).toEqual({ verb: "Listar", subject: "pruebas/" });
    expect(describeCall("ls", {}, cwd)).toEqual({ verb: "Listar", subject: "./" });
  });
  it("devuelve undefined para herramientas desconocidas", () => {
    expect(describeCall("read_pdf", { path: "x.pdf" }, cwd)).toBeUndefined();
  });
});
