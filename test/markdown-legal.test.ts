import { describe, expect, it } from "vitest";
import { highlightLegalMarkdown } from "../src/lib/markdown-legal.js";

describe("highlightLegalMarkdown", () => {
  it("realza Roj y ECLI con etiqueta en negrita e identificador en código", () => {
    const out = highlightLegalMarkdown(
      "Según la STS (Roj: STS 1234:2025 · ECLI: ES:TS:2025:1234) de 12 de marzo.",
    );
    expect(out).toBe("Según la STS (**Roj:** `STS 1234:2025` · **ECLI:** `ES:TS:2025:1234`) de 12 de marzo.");
  });

  it("realza DEROGADO y las fechas de modificación", () => {
    const out = highlightLegalMarkdown(
      "El artículo (actualmente DEROGADO) establecía… El art. 228 (modificado el 2015-07-22 por BOE) dice…",
    );
    expect(out).toContain("(actualmente **DEROGADO**)");
    expect(out).toContain("(**modificado el 2015-07-22** por BOE)");
  });

  it("no toca las URL de los enlaces ni el código", () => {
    const md =
      "[Artículo 404 de la LEC](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404) y `Roj: STS 1:2020`\n```\nRoj: STS 2:2020 DEROGADO\n```";
    expect(highlightLegalMarkdown(md)).toBe(md);
  });

  it("realza dentro de la etiqueta de un enlace sin romper el enlace", () => {
    const out = highlightLegalMarkdown(
      "[STS de 2025 (Roj: STS 1234:2025)](https://visor.example.org/search?id=1)",
    );
    expect(out).toBe("[STS de 2025 (**Roj:** `STS 1234:2025`)](https://visor.example.org/search?id=1)");
  });

  it("no duplica el realce si ya viene en negrita", () => {
    const md = "**Roj:** STS 1234:2025 y **DEROGADO**";
    expect(highlightLegalMarkdown(md)).toBe(md);
  });

  it("no altera texto sin identificadores", () => {
    const md = "El demandado dispone de veinte días hábiles para contestar.";
    expect(highlightLegalMarkdown(md)).toBe(md);
  });
});
