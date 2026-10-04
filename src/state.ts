import { EventEmitter } from "node:events";
import type { Tarea } from "./lib/tareas.js";

/** Estado compartido entre extensiones (expediente activo, citas) con notificación de cambios. */
export interface ExpedienteState {
  dir?: string;
  name?: string;
  instructions?: string;
}

class LetradoState extends EventEmitter {
  expediente: ExpedienteState = {};
  /** Número de citas servidas por herramientas en la sesión (para el footer). */
  citationsServed = 0;
  /** Número de citas no verificadas eliminadas en la sesión. */
  citationsStripped = 0;
  /** Rutas de documentos leídos en esta sesión (read, read_pdf, read_docx). */
  documentsRead = new Set<string>();
  /** Lista de tareas que mantiene el modelo (herramienta `tareas`). */
  tareas: Tarea[] = [];

  setExpediente(next: ExpedienteState): void {
    this.expediente = next;
    this.emit("change");
  }

  setCitationCounts(served: number, stripped: number): void {
    this.citationsServed = served;
    this.citationsStripped = stripped;
    this.emit("change");
  }

  addDocumentRead(path: string): void {
    if (!path || this.documentsRead.has(path)) return;
    this.documentsRead.add(path);
    this.emit("change");
  }

  resetDocumentsRead(): void {
    if (this.documentsRead.size === 0) return;
    this.documentsRead.clear();
    this.emit("change");
  }

  setTareas(items: Tarea[]): void {
    this.tareas = items.map((t) => ({ ...t }));
    this.emit("change");
  }

  reset(): void {
    this.expediente = {};
    this.citationsServed = 0;
    this.citationsStripped = 0;
    this.documentsRead = new Set();
    this.tareas = [];
    this.emit("change");
  }
}

export const state = new LetradoState();
