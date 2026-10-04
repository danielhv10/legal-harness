import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText, parsePageRange } from "../src/lib/pdf.js";

const fixtures = join(import.meta.dirname, "fixtures");

describe("parsePageRange", () => {
  it("interpreta rangos y páginas sueltas", () => {
    expect(parsePageRange("1-3,7")).toEqual([1, 2, 3, 7]);
    expect(parsePageRange(" 2 , 1 ")).toEqual([1, 2]);
    expect(parsePageRange("5-6, 5")).toEqual([5, 6]);
  });

  it("recorta al total de páginas", () => {
    expect(parsePageRange("1-10", 3)).toEqual([1, 2, 3]);
  });

  it("rechaza formatos inválidos con mensaje en español", () => {
    expect(() => parsePageRange("a-b")).toThrow(/no válido/);
    expect(() => parsePageRange("0")).toThrow(/empiezan en 1/);
    expect(() => parsePageRange("5-2")).toThrow(/invertido/);
    expect(() => parsePageRange("")).toThrow(/vacío/);
  });
});

describe("extractPdfText", () => {
  it("extrae dos páginas con prefijo --- Página N ---", async () => {
    const result = await extractPdfText(join(fixtures, "sample.pdf"));
    expect(result.totalPages).toBe(2);
    expect(result.pages).toEqual([1, 2]);
    expect(result.scanned).toBe(false);
    expect(result.text).toContain("--- Página 1 ---");
    expect(result.text).toContain("Página uno");
    expect(result.text).toContain("--- Página 2 ---");
    expect(result.text).toContain("Página dos");
  });

  it("acepta bytes y una selección de páginas", async () => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, "sample.pdf")));
    const result = await extractPdfText(bytes, { pages: [2] });
    expect(result.pages).toEqual([2]);
    expect(result.text).not.toContain("Página uno");
    expect(result.text).toContain("Página dos");
  });

  it("respeta maxPages cuando no se indican páginas", async () => {
    const result = await extractPdfText(join(fixtures, "sample.pdf"), { maxPages: 1 });
    expect(result.pages).toEqual([1]);
    expect(result.totalPages).toBe(2);
  });

  it("detecta PDFs escaneados sin capa de texto", async () => {
    const result = await extractPdfText(join(fixtures, "scanned.pdf"));
    expect(result.totalPages).toBe(2);
    expect(result.scanned).toBe(true);
  });

  it("falla con mensaje en español si las páginas no existen", async () => {
    await expect(extractPdfText(join(fixtures, "sample.pdf"), { pages: [9] })).rejects.toThrow(
      /Ninguna de las páginas/,
    );
  });
});
