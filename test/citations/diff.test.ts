import { describe, expect, it } from "vitest";

import { diffCitations } from "../../src/lib/citations/diff.js";

describe("diffCitations", () => {
  it("devuelve [] si no hay cambios", () => {
    expect(diffCitations("a", "a")).toEqual([]);
  });

  it("detecta enlaces colapsados con su etiqueta", () => {
    const before = "Ver [Art. 1](https://www.boe.es/a#1) y [Art. 2](https://www.boe.es/a#2).";
    const after = "Ver Art. 1 y [Art. 2](https://www.boe.es/a#2).";
    expect(diffCitations(before, after)).toEqual([
      { kind: "url", value: "https://www.boe.es/a#1", label: "Art. 1" },
    ]);
  });

  it("detecta Roj y ECLI eliminados sin duplicados", () => {
    const before = "STS (Roj: STS 1:2024 · ECLI: ES:TS:2024:1) y otra vez ECLI: ES:TS:2024:1.";
    const after = "STS (Roj: STS 1:2024).";
    expect(diffCitations(before, after)).toEqual([{ kind: "ecli", value: "ES:TS:2024:1" }]);
  });

  it("no cuenta un Roj que solo ha sido cualificado (bare → Roj:)", () => {
    expect(diffCitations("Ver STS 1:2024.", "Ver Roj: STS 1:2024.")).toEqual([]);
  });

  it("no cuenta una URL que sigue presente aunque haya cambiado la etiqueta", () => {
    const before = "[x](https://visor.example.org/search?id=1&type=cendoj)";
    const after = "[etiqueta servida](https://visor.example.org/search?id=1&type=cendoj)";
    expect(diffCitations(before, after)).toEqual([]);
  });
});
