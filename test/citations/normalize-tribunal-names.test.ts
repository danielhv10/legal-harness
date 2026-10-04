import { describe, expect, it } from "vitest";

import {
  hasOldTribunalNames,
  normalizeTribunalNames,
} from "../../src/lib/citations/normalize-tribunal-names.js";

describe("normalizeTribunalNames", () => {
  describe("basic transformations", () => {
    it("should transform Juzgado de Primera Instancia", () => {
      const input = "El Juzgado de Primera Instancia dictó sentencia.";
      const expected = "El Tribunal de Instancia. Sección Civil dictó sentencia.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Primera Instancia e Instrucción", () => {
      const input = "El Juzgado de Primera Instancia e Instrucción resolvió el caso.";
      const expected = "El Tribunal de Instancia. Sección Civil y de Instrucción resolvió el caso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Instrucción", () => {
      const input = "El Juzgado de Instrucción inició diligencias.";
      const expected = "El Tribunal de Instancia. Sección de Instrucción inició diligencias.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de lo Social", () => {
      const input = "El Juzgado de lo Social falló a favor del trabajador.";
      const expected = "El Tribunal de Instancia. Sección de lo Social falló a favor del trabajador.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de lo Contencioso-Administrativo", () => {
      const input = "El Juzgado de lo Contencioso-Administrativo anuló la resolución.";
      const expected =
        "El Tribunal de Instancia. Sección de lo Contencioso-Administrativo anuló la resolución.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Paz", () => {
      const input = "El Juzgado de Paz tramitó el asunto.";
      const expected = "El Oficina de Justicia en el municipio tramitó el asunto.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de lo Mercantil", () => {
      const input = "El Juzgado de lo Mercantil declaró el concurso.";
      const expected = "El Tribunal de Instancia. Sección de lo Mercantil declaró el concurso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Violencia Sobre la Mujer", () => {
      const input = "El Juzgado de Violencia Sobre la Mujer dictó orden.";
      const expected = "El Tribunal de Instancia. Sección de Violencia sobre la Mujer dictó orden.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de lo Penal", () => {
      const input = "El Juzgado de lo Penal condenó al acusado.";
      const expected = "El Tribunal de Instancia. Sección de lo Penal condenó al acusado.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Vigilancia Penitenciaria", () => {
      const input = "El Juzgado de Vigilancia Penitenciaria concedió el permiso.";
      const expected = "El Tribunal de Instancia. Sección de Vigilancia Penitenciaria concedió el permiso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Juzgado de Menores", () => {
      const input = "El Juzgado de Menores aplicó medidas educativas.";
      const expected = "El Tribunal de Instancia. Sección de Menores aplicó medidas educativas.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });
  });

  describe("Audiencia Nacional transformations", () => {
    it("should transform Audiencia Nacional. Juzgado Central de Instrucción", () => {
      const input = "La Audiencia Nacional. Juzgado Central de Instrucción abrió causa.";
      const expected = "La Tribunal Central de Instancia. Sección de Instrucción abrió causa.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Audiencia Nacional. Juzgado Central de lo Penal", () => {
      const input = "La Audiencia Nacional. Juzgado Central de lo Penal juzgó el caso.";
      const expected = "La Tribunal Central de Instancia. Sección de lo Penal juzgó el caso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform Audiencia Nacional. Juzgado Central de lo Contencioso-Administrativo", () => {
      const input =
        "La Audiencia Nacional. Juzgado Central de lo Contencioso-Administrativo revisó el recurso.";
      const expected =
        "La Tribunal Central de Instancia. Sección de lo Contencioso-Administrativo revisó el recurso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });
  });

  describe("tribunal names with location suffixes", () => {
    it("should transform tribunal name and preserve location suffix", () => {
      const input = "El Juzgado de Primera Instancia de Madrid dictó sentencia favorable.";
      const expected = "El Tribunal de Instancia. Sección Civil de Madrid dictó sentencia favorable.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform tribunal name and preserve number suffix", () => {
      const input = "El Juzgado de Primera Instancia nº 3 de Barcelona resolvió el caso.";
      const expected = "El Tribunal de Instancia. Sección Civil nº 3 de Barcelona resolvió el caso.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should handle composite location names", () => {
      const input = "El Juzgado de lo Social de Santiago de Compostela falló.";
      const expected = "El Tribunal de Instancia. Sección de lo Social de Santiago de Compostela falló.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });
  });

  describe("multiple transformations in same text", () => {
    it("should transform multiple different tribunal types", () => {
      const input = "El Juzgado de Primera Instancia remitió el caso al Juzgado de Instrucción.";
      const expected =
        "El Tribunal de Instancia. Sección Civil remitió el caso al Tribunal de Instancia. Sección de Instrucción.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should transform multiple occurrences of same tribunal type", () => {
      const input = "El Juzgado de lo Social de Madrid y el Juzgado de lo Social de Barcelona.";
      const expected =
        "El Tribunal de Instancia. Sección de lo Social de Madrid y el Tribunal de Instancia. Sección de lo Social de Barcelona.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase", () => {
      const input = "El JUZGADO DE PRIMERA INSTANCIA dictó sentencia.";
      const expected = "El Tribunal de Instancia. Sección Civil dictó sentencia.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });

    it("should handle mixed case", () => {
      const input = "El juzgado de Primera instancia dictó sentencia.";
      const expected = "El Tribunal de Instancia. Sección Civil dictó sentencia.";
      expect(normalizeTribunalNames(input)).toBe(expected);
    });
  });

  describe("tribunals that should NOT be transformed", () => {
    it("should NOT transform Tribunal Supremo", () => {
      const input = "El Tribunal Supremo confirmó la sentencia.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });

    it("should NOT transform Audiencia Nacional (Salas)", () => {
      const input = "La Audiencia Nacional. Sala de lo Penal absolvió.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });

    it("should NOT transform Tribunal Superior de Justicia", () => {
      const input = "El Tribunal Superior de Justicia de Madrid desestimó.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });

    it("should NOT transform Audiencia Provincial", () => {
      const input = "La Audiencia Provincial de Barcelona confirmó.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });

    it("should NOT transform already-new tribunal names", () => {
      const input = "El Tribunal de Instancia. Sección Civil dictó sentencia.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });
  });

  describe("edge cases", () => {
    it("should return empty string for empty input", () => {
      expect(normalizeTribunalNames("")).toBe("");
    });

    it("should return null/undefined unchanged", () => {
      expect(normalizeTribunalNames(null as unknown as string)).toBe(null);
      expect(normalizeTribunalNames(undefined as unknown as string)).toBe(undefined);
    });

    it("should handle text with no tribunal names", () => {
      const input = "Este es un texto sin menciones a tribunales.";
      expect(normalizeTribunalNames(input)).toBe(input);
    });
  });
});

describe("hasOldTribunalNames", () => {
  it("should return true when old tribunal name is present", () => {
    expect(hasOldTribunalNames("El Juzgado de Primera Instancia dictó sentencia.")).toBe(true);
  });

  it("should return true for Juzgado de lo Social", () => {
    expect(hasOldTribunalNames("Ante el Juzgado de lo Social")).toBe(true);
  });

  it("should return false when no old tribunal names present", () => {
    expect(hasOldTribunalNames("El Tribunal de Instancia. Sección Civil dictó sentencia.")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(hasOldTribunalNames("")).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(hasOldTribunalNames(null as unknown as string)).toBe(false);
    expect(hasOldTribunalNames(undefined as unknown as string)).toBe(false);
  });

  it("should be case insensitive", () => {
    expect(hasOldTribunalNames("JUZGADO DE PRIMERA INSTANCIA")).toBe(true);
    expect(hasOldTribunalNames("juzgado de primera instancia")).toBe(true);
  });
});
