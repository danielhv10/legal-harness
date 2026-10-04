import { describe, expect, it } from "vitest";
import {
  applyAccion,
  countTareas,
  currentIndex,
  formatTareasText,
  summarizeTareas,
  type Tarea,
} from "../src/lib/tareas.js";

const base: Tarea[] = [
  { text: "Leer la demanda", done: true },
  { text: "Redactar contestación", done: false },
  { text: "Revisar plazos", done: false },
];

describe("applyAccion", () => {
  it("definir sustituye la lista y deja todo pendiente", () => {
    const r = applyAccion(base, { accion: "definir", tareas: [" Uno ", "Dos", "  "] });
    expect(r.error).toBeUndefined();
    expect(r.items).toEqual([
      { text: "Uno", done: false },
      { text: "Dos", done: false },
    ]);
  });

  it("definir sin tareas devuelve error en español y no toca la lista", () => {
    const r = applyAccion(base, { accion: "definir", tareas: [] });
    expect(r.error).toMatch(/definir.*requiere/);
    expect(r.items).toEqual(base);
  });

  it("añadir anexa al final sin mutar la lista original", () => {
    const copy = structuredClone(base);
    const r = applyAccion(base, { accion: "añadir", tareas: ["Preparar escrito"] });
    expect(r.items).toHaveLength(4);
    expect(r.items[3]).toEqual({ text: "Preparar escrito", done: false });
    expect(base).toEqual(copy);
    expect(applyAccion(base, { accion: "añadir" }).error).toMatch(/añadir.*requiere/);
  });

  it("completar marca por índice 1-based y es idempotente", () => {
    const r = applyAccion(base, { accion: "completar", indice: 2 });
    expect(r.error).toBeUndefined();
    expect(r.items[1]?.done).toBe(true);
    expect(base[1]?.done).toBe(false);
    const again = applyAccion(r.items, { accion: "completar", indice: 2 });
    expect(again.error).toBeUndefined();
    expect(again.items).toEqual(r.items);
  });

  it("completar valida límites e índice ausente", () => {
    expect(applyAccion(base, { accion: "completar", indice: 0 }).error).toMatch(/fuera de rango/);
    expect(applyAccion(base, { accion: "completar", indice: 4 }).error).toMatch(/fuera de rango.*1–3/);
    expect(applyAccion(base, { accion: "completar", indice: 1.5 }).error).toMatch(/requiere `indice`/);
    expect(applyAccion(base, { accion: "completar" }).error).toMatch(/requiere `indice`/);
    expect(applyAccion([], { accion: "completar", indice: 1 }).error).toMatch(/No hay tareas/);
  });

  it("limpiar vacía la lista", () => {
    expect(applyAccion(base, { accion: "limpiar" }).items).toEqual([]);
  });

  it("acción desconocida devuelve error", () => {
    const r = applyAccion(base, { accion: "borrar" as never });
    expect(r.error).toMatch(/Acción desconocida/);
  });
});

describe("formateadores", () => {
  it("formatTareasText numera y marca [x]", () => {
    expect(formatTareasText(base)).toBe(
      "1. [x] Leer la demanda\n2. [ ] Redactar contestación\n3. [ ] Revisar plazos",
    );
    expect(formatTareasText([])).toBe("Sin tareas.");
  });

  it("summarizeTareas y countTareas", () => {
    expect(summarizeTareas(base)).toBe("Tareas: 2 pendientes · 1 completada");
    expect(summarizeTareas([{ text: "a", done: false }])).toBe("Tareas: 1 pendiente");
    expect(
      summarizeTareas([
        { text: "a", done: true },
        { text: "b", done: true },
      ]),
    ).toBe("Tareas: 2 completadas");
    expect(summarizeTareas([])).toBe("Tareas: ninguna");
    expect(countTareas(base)).toEqual({ pendientes: 2, completadas: 1 });
  });

  it("currentIndex apunta a la primera pendiente", () => {
    expect(currentIndex(base)).toBe(1);
    expect(currentIndex([{ text: "a", done: true }])).toBe(-1);
    expect(currentIndex([])).toBe(-1);
  });
});
