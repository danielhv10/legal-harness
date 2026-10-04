import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExpedienteSection, readExpediente } from "../src/lib/expediente.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeExpediente(withInstructions: boolean, n = 3): string {
  const d = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "exp-"));
  dirs.push(d);
  if (withInstructions)
    writeFileSync(
      join(d, "EXPEDIENTE.md"),
      "# Expediente: García c. Constructora SL\n\n## Partes\n- Cliente: García\n",
    );
  for (let i = 0; i < n; i++) writeFileSync(join(d, `doc-${i}.pdf`), "x");
  writeFileSync(join(d, "contrato.docx"), "x");
  writeFileSync(join(d, "notas.md"), "x");
  mkdirSync(join(d, "pruebas"));
  return d;
}

describe("readExpediente", () => {
  it("toma el nombre del título de EXPEDIENTE.md y clasifica ficheros", () => {
    const info = readExpediente(makeExpediente(true));
    expect(info.name).toBe("García c. Constructora SL");
    expect(info.instructions).toContain("Cliente: García");
    expect(info.files.find((f) => f.name === "contrato.docx")?.kind).toBe("docx");
    expect(info.files.find((f) => f.name === "doc-0.pdf")?.kind).toBe("pdf");
    expect(info.files.find((f) => f.name === "pruebas")?.kind).toBe("dir");
    expect(info.truncated).toBe(false);
  });

  it("usa el nombre del directorio si no hay instrucciones y trunca a 60 entradas", () => {
    const d = makeExpediente(false, 70);
    const info = readExpediente(d);
    expect(info.name).toBe(d.split("/").pop());
    expect(info.files.length).toBe(60);
    expect(info.truncated).toBe(true);
  });
});

describe("buildExpedienteSection", () => {
  it("incluye instrucciones, listado con herramienta sugerida y regla de citas", () => {
    const s = buildExpedienteSection(readExpediente(makeExpediente(true)));
    expect(s).toContain("Expediente activo: García c. Constructora SL");
    expect(s).toContain("contrato.docx (1 B) → read_docx");
    expect(s).toContain("doc-0.pdf (1 B) → read_pdf");
    expect(s).toContain("pruebas/ → ls");
    expect(s).toContain("**negrita**");
  });
  it("propone crear EXPEDIENTE.md cuando falta", () => {
    const s = buildExpedienteSection(readExpediente(makeExpediente(false)));
    expect(s).toContain("/expediente init");
  });
});
