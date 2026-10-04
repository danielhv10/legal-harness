import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyGuard, normalizeOutsideProtected } from "../../src/lib/citations/guard.js";
import { emptyAllowed, harvestFromToolResult } from "../../src/lib/citations/harvest.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEXT = readFileSync(join(here, "../fixtures/research-result.txt"), "utf8");
const { allowed } = harvestFromToolResult(
  "mcp__fuentes__research",
  [{ type: "text", text: TEXT }],
  undefined,
);
const NO_WEB = new Set<string>();

describe("applyGuard", () => {
  it("elimina un ECLI inventado y lo registra", () => {
    const input = "Así lo declaró el Tribunal Supremo (Roj: STS 1234:2024 · ECLI: ES:TS:2024:9999).";
    const { text, stripped } = applyGuard(input, allowed, NO_WEB);
    expect(text).toBe("Así lo declaró el Tribunal Supremo (Roj: STS 1234:2024).");
    expect(stripped).toEqual([{ kind: "ecli", value: "ES:TS:2024:9999" }]);
  });

  it("colapsa un enlace cuya URL reutiliza el id de otra norma", () => {
    const input =
      "Ver [Artículo 20 de la Ley Hipotecaria](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a20).";
    const { text, stripped } = applyGuard(input, allowed, NO_WEB);
    expect(text).toBe("Ver Artículo 20 de la Ley Hipotecaria.");
    expect(stripped).toEqual([
      {
        kind: "url",
        value: "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a20",
        label: "Artículo 20 de la Ley Hipotecaria",
      },
    ]);
  });

  it("conserva los enlaces servidos y repara un BOE-A sin enlace", () => {
    const input =
      "Según el [Artículo 404 LEC](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404), modificado por BOE-A-2015-10727.";
    const { text, stripped } = applyGuard(input, allowed, NO_WEB);
    expect(text).toBe(
      "Según el [Artículo 404 LEC](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404), modificado por [BOE-A-2015-10727](https://www.boe.es/buscar/act.php?id=BOE-A-2015-10727).",
    );
    expect(stripped).toEqual([]);
  });

  it("trata las URLs de web_fetch como servidas sin mutar allowed", () => {
    const web = new Set(["https://www.poderjudicial.es/nota"]);
    const input =
      "Fuente: [nota de prensa](https://www.poderjudicial.es/nota) y [otra](https://example.com/x).";
    const { text, stripped } = applyGuard(input, allowed, web);
    expect(text).toBe("Fuente: [nota de prensa](https://www.poderjudicial.es/nota) y otra.");
    expect(stripped).toEqual([{ kind: "url", value: "https://example.com/x", label: "otra" }]);
    expect(allowed.urls.has("https://www.poderjudicial.es/nota")).toBe(false);
  });

  it("normaliza órganos en prosa pero no dentro de blockquotes ni etiquetas de enlace", () => {
    const input = [
      "El Juzgado de Primera Instancia de Madrid admitió la demanda.",
      "> «El Juzgado de Primera Instancia nº 3 dictó auto…»",
      "Véase [Juzgado de lo Mercantil de Barcelona, auto de 2024](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404) y el Juzgado de lo Mercantil citado.",
    ].join("\n");
    const { text, stripped } = applyGuard(input, allowed, NO_WEB);
    expect(text.split("\n")).toEqual([
      "El Tribunal de Instancia. Sección Civil de Madrid admitió la demanda.",
      "> «El Juzgado de Primera Instancia nº 3 dictó auto…»",
      "Véase [Juzgado de lo Mercantil de Barcelona, auto de 2024](https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404) y el Tribunal de Instancia. Sección de lo Mercantil citado.",
    ]);
    expect(stripped).toEqual([]);
  });

  it("vía rápida: sin lista blanca y sin formas de cita devuelve el texto idéntico", () => {
    const input = "Hola, ¿en qué puedo ayudarte? Puedo leer el PDF de la demanda.";
    const result = applyGuard(input, emptyAllowed(), NO_WEB);
    expect(result.text).toBe(input);
    expect(result.stripped).toEqual([]);
  });

  it("sin lista blanca, los Roj/ECLI y enlaces del modelo se eliminan igualmente", () => {
    const input = "Ver [STS](https://example.com) (Roj: STS 1:2020).";
    const { text, stripped } = applyGuard(input, emptyAllowed(), NO_WEB);
    expect(text).toBe("Ver STS.");
    expect(stripped.map((s) => s.kind).sort()).toEqual(["roj", "url"]);
  });
});

describe("normalizeOutsideProtected", () => {
  it("es no-op sin nombres antiguos", () => {
    const t = "El Tribunal Supremo resolvió.";
    expect(normalizeOutsideProtected(t)).toBe(t);
  });

  it("respeta blockquotes con sangría previa", () => {
    const t = "  > Juzgado de Paz de Soria";
    expect(normalizeOutsideProtected(t)).toBe(t);
  });
});
