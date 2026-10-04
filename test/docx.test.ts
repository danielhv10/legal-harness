import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readDocxAsMarkdown } from "../src/lib/docx-read.js";
import { markdownToDocx, markdownToDocxDetailed } from "../src/lib/docx-write.js";

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "letrado-docx-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SAMPLE = `# Dictamen sobre la prescripción

## Antecedentes de hecho

El **demandante** sufrió un daño el *1 de marzo de 2022* y reclamó extrajudicialmente mediante burofax.

- Primer hecho relevante
- Segundo hecho relevante
  - Subapartado anidado

1. Fundamento primero
2. Fundamento segundo

> Cita literal del artículo 1968.2 del Código Civil.

| Concepto | Importe |
|---|---|
| Daño emergente | 1.000 € |
| Lucro cesante | 500 € |

Código inline: \`art. 1902 CC\` y un [enlace](https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763).

---

Texto tras el salto de página.
`;

describe("markdownToDocx → readDocxAsMarkdown (round-trip)", () => {
  it("genera un .docx válido y conserva encabezados, listas, negritas y tablas", async () => {
    const { buffer, paragraphs } = await markdownToDocxDetailed(SAMPLE, { title: "Dictamen" });
    expect(buffer.length).toBeGreaterThan(2000);
    // Firma ZIP (PK).
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(paragraphs).toBeGreaterThan(10);

    const path = join(dir, "dictamen.docx");
    writeFileSync(path, buffer);

    const { markdown, messages } = await readDocxAsMarkdown(path);
    expect(Array.isArray(messages)).toBe(true);
    expect(markdown).toContain("# Dictamen sobre la prescripción");
    expect(markdown).toContain("## Antecedentes de hecho");
    expect(markdown).toContain("**demandante**");
    expect(markdown).toMatch(/1 de marzo de 2022/);
    expect(markdown).toContain("Primer hecho relevante");
    expect(markdown).toContain("Segundo hecho relevante");
    expect(markdown).toContain("Subapartado anidado");
    expect(markdown).toContain("Fundamento primero");
    expect(markdown).toContain("Cita literal del artículo 1968.2");
    expect(markdown).toContain("Daño emergente");
    expect(markdown).toContain("1.000 €");
    expect(markdown).toContain("art. 1902 CC");
    expect(markdown).toContain("Texto tras el salto de página");
  });

  it("markdownToDocx devuelve un Buffer", async () => {
    const buf = await markdownToDocx("Hola **mundo**");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("readDocxAsMarkdown falla con mensaje en español si el archivo no es un docx", async () => {
    const bad = join(dir, "no-es-docx.docx");
    writeFileSync(bad, "esto no es un zip");
    await expect(readDocxAsMarkdown(bad)).rejects.toThrow(/No se pudo leer el documento Word/);
  });
});
