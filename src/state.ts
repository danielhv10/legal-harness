import { EventEmitter } from "node:events";

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

  setExpediente(next: ExpedienteState): void {
    this.expediente = next;
    this.emit("change");
  }

  setCitationCounts(served: number, stripped: number): void {
    this.citationsServed = served;
    this.citationsStripped = stripped;
    this.emit("change");
  }

  reset(): void {
    this.expediente = {};
    this.citationsServed = 0;
    this.citationsStripped = 0;
    this.emit("change");
  }
}

export const state = new LetradoState();
