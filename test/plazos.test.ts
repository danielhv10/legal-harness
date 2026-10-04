import { describe, expect, it } from "vitest";
import {
  diasHasta,
  estadoPlazo,
  formatPlazo,
  formatPlazoDate,
  nextPlazo,
  parsePlazoLine,
  parsePlazos,
} from "../src/lib/plazos.js";

const MD = `# Expediente: García c. Constructora SL

## Partes
- Cliente: García

## Plazos próximos
- [12/10/2026] — Contestación a la demanda
- 05/11/2026 — Audiencia previa
- 2026-09-30 — Aportar dictamen pericial
- [dd/mm/aaaa] — [actuación]
- Sin fecha: comprobar notificación
* 1/1/2027 Vista oral

## Instrucciones para letrado
- 31/12/2026 — esto no es un plazo (otra sección)
`;

describe("parsePlazos", () => {
  it("lee dd/mm/aaaa con y sin corchetes e ISO, ordenados por fecha", () => {
    const plazos = parsePlazos(MD);
    expect(plazos.map((p) => formatPlazo(p))).toEqual([
      "30/09/2026 — Aportar dictamen pericial",
      "12/10/2026 — Contestación a la demanda",
      "05/11/2026 — Audiencia previa",
      "01/01/2027 — Vista oral",
    ]);
  });

  it("ignora las líneas de plantilla con [dd/mm/aaaa] literal", () => {
    expect(parsePlazos("## Plazos próximos\n- [dd/mm/aaaa] — [actuación]\n")).toEqual([]);
  });

  it("solo lee la sección de plazos y tolera un documento vacío", () => {
    expect(parsePlazos(undefined)).toEqual([]);
    expect(parsePlazos("# Nada\n- 01/01/2027 — fuera de sección")).toEqual([]);
    const plazos = parsePlazos(MD);
    expect(plazos.some((p) => p.text.includes("otra sección"))).toBe(false);
  });

  it("descarta fechas imposibles", () => {
    expect(parsePlazos("## Plazos próximos\n- 31/02/2026 — imposible\n- 13/13/2026 — mes 13")).toEqual([]);
  });

  it("parsePlazoLine admite separadores — – - : y texto antes de la fecha", () => {
    expect(parsePlazoLine("03/03/2026 - Recurso")?.text).toBe("Recurso");
    expect(parsePlazoLine("03/03/2026: Recurso")?.text).toBe("Recurso");
    expect(parsePlazoLine("Recurso — 03/03/2026")?.text).toBe("Recurso");
    expect(parsePlazoLine("**Recurso** [03/03/2026]")?.text).toBe("Recurso");
    expect(parsePlazoLine("texto sin fecha")).toBeUndefined();
  });
});

describe("nextPlazo", () => {
  const now = new Date(2026, 9, 5); // 05/10/2026

  it("devuelve el primer plazo de hoy en adelante", () => {
    const plazos = parsePlazos(MD);
    expect(formatPlazoDate(nextPlazo(plazos, now)?.date as Date)).toBe("12/10/2026");
  });

  it("acepta el mismo día como pendiente", () => {
    const plazos = parsePlazos("## Plazos próximos\n- 05/10/2026 — Hoy\n- 20/10/2026 — Luego");
    expect(nextPlazo(plazos, new Date(2026, 9, 5, 23, 30))?.text).toBe("Hoy");
  });

  it("si todos han vencido, devuelve el vencido más reciente", () => {
    const plazos = parsePlazos("## Plazos próximos\n- 01/01/2026 — Antiguo\n- 01/06/2026 — Reciente");
    const next = nextPlazo(plazos, now);
    expect(next?.text).toBe("Reciente");
    expect(estadoPlazo(next as NonNullable<typeof next>, now)).toBe("pasado");
    expect(diasHasta(next as NonNullable<typeof next>, now)).toBeLessThan(0);
  });

  it("no depende del orden de entrada y devuelve undefined sin plazos", () => {
    const a = { date: new Date(2026, 10, 1), text: "b" };
    const b = { date: new Date(2026, 9, 10), text: "a" };
    expect(nextPlazo([a, b], now)?.text).toBe("a");
    expect(nextPlazo([], now)).toBeUndefined();
  });
});

describe("estadoPlazo", () => {
  const now = new Date(2026, 9, 5);
  it("clasifica pasado / inminente (≤7 días) / pendiente", () => {
    expect(estadoPlazo({ date: new Date(2026, 9, 4), text: "" }, now)).toBe("pasado");
    expect(estadoPlazo({ date: new Date(2026, 9, 5), text: "" }, now)).toBe("inminente");
    expect(estadoPlazo({ date: new Date(2026, 9, 12), text: "" }, now)).toBe("inminente");
    expect(estadoPlazo({ date: new Date(2026, 9, 13), text: "" }, now)).toBe("pendiente");
  });
});
