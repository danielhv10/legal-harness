/**
 * Lista de tareas que mantiene el modelo (estilo Claude Code): reducer puro y formateadores.
 */

export interface Tarea {
  text: string;
  done: boolean;
}

export type TareasAccion = "definir" | "completar" | "añadir" | "limpiar";

export interface TareasParams {
  accion: TareasAccion;
  tareas?: string[];
  /** Índice 1-based (para `completar`). */
  indice?: number;
}

export interface TareasResult {
  items: Tarea[];
  error?: string;
}

/** Máximo de tareas que el widget muestra antes de resumir con "+N más". */
export const WIDGET_MAX_ITEMS = 6;

function cleanList(tareas: string[] | undefined): string[] {
  return (tareas ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
}

/** Aplica una acción sobre la lista y devuelve la nueva lista (nunca muta `items`). */
export function applyAccion(items: readonly Tarea[], params: TareasParams): TareasResult {
  const current = items.map((t) => ({ ...t }));
  switch (params.accion) {
    case "definir": {
      const list = cleanList(params.tareas);
      if (list.length === 0) {
        return { items: current, error: "La acción `definir` requiere `tareas` con al menos un elemento." };
      }
      return { items: list.map((text) => ({ text, done: false })) };
    }
    case "añadir": {
      const list = cleanList(params.tareas);
      if (list.length === 0) {
        return { items: current, error: "La acción `añadir` requiere `tareas` con al menos un elemento." };
      }
      return { items: [...current, ...list.map((text) => ({ text, done: false }))] };
    }
    case "completar": {
      const i = params.indice;
      if (i === undefined || !Number.isInteger(i)) {
        return { items: current, error: "La acción `completar` requiere `indice` (entero, empezando en 1)." };
      }
      if (current.length === 0) {
        return { items: current, error: "No hay tareas que completar: define la lista primero." };
      }
      if (i < 1 || i > current.length) {
        return {
          items: current,
          error: `Índice ${i} fuera de rango: la lista tiene ${current.length} ${current.length === 1 ? "tarea" : "tareas"} (1–${current.length}).`,
        };
      }
      const target = current[i - 1];
      if (target) target.done = true;
      return { items: current };
    }
    case "limpiar":
      return { items: [] };
    default:
      return {
        items: current,
        error: `Acción desconocida: ${String((params as { accion: unknown }).accion)}`,
      };
  }
}

/** Índice (0-based) de la tarea en curso: la primera pendiente, o -1. */
export function currentIndex(items: readonly Tarea[]): number {
  return items.findIndex((t) => !t.done);
}

export function countTareas(items: readonly Tarea[]): { pendientes: number; completadas: number } {
  let completadas = 0;
  for (const t of items) if (t.done) completadas++;
  return { pendientes: items.length - completadas, completadas };
}

/** Lista en texto plano para el modelo: `1. [x] …`. */
export function formatTareasText(items: readonly Tarea[]): string {
  if (items.length === 0) return "Sin tareas.";
  return items.map((t, i) => `${i + 1}. [${t.done ? "x" : " "}] ${t.text}`).join("\n");
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Resumen compacto: "Tareas: 3 pendientes · 1 completada". */
export function summarizeTareas(items: readonly Tarea[]): string {
  if (items.length === 0) return "Tareas: ninguna";
  const { pendientes, completadas } = countTareas(items);
  const parts: string[] = [];
  if (pendientes > 0) parts.push(plural(pendientes, "pendiente", "pendientes"));
  if (completadas > 0) parts.push(plural(completadas, "completada", "completadas"));
  return `Tareas: ${parts.join(" · ")}`;
}
