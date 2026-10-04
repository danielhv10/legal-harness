/**
 * Formato puro para la interfaz (sin dependencias de la TUI): barra de contexto,
 * mensajes de trabajo por herramienta, etc.
 */

export const CONTEXT_BAR_CELLS = 10;

/** Barra de 10 celdas `▰▰▰▱▱▱▱▱▱▱` proporcional al porcentaje (0-100). */
export function contextBar(percent: number, cells = CONTEXT_BAR_CELLS): string {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const filled = Math.round((clamped / 100) * cells);
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

export type ContextLevel = "success" | "warning" | "error";

/** Color semántico de la barra: verde < 60 %, aviso < 85 %, error en adelante. */
export function contextLevel(percent: number): ContextLevel {
  if (percent < 60) return "success";
  if (percent < 85) return "warning";
  return "error";
}

export const DEFAULT_WORKING_MESSAGE = "Analizando…";

/** Mensaje de trabajo que se muestra mientras corre una herramienta. */
export function workingMessageFor(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    if (toolName.includes("__research")) return "Investigando en las fuentes jurídicas…";
    if (toolName.includes("__search_legal")) return "Buscando legislación y jurisprudencia…";
    if (toolName.includes("__get_document")) return "Leyendo el documento completo…";
    return "Consultando las fuentes jurídicas…";
  }
  switch (toolName) {
    case "read_pdf":
      return "Leyendo el PDF…";
    case "read_docx":
      return "Leyendo el documento Word…";
    case "write_docx":
      return "Redactando el documento Word…";
    case "web_search":
      return "Buscando en la web…";
    case "web_fetch":
      return "Leyendo la página web…";
    case "bash":
      return "Ejecutando un comando…";
    case "read":
    case "grep":
    case "find":
    case "ls":
      return "Revisando el expediente…";
    case "edit":
    case "write":
      return "Editando el fichero…";
    default:
      return DEFAULT_WORKING_MESSAGE;
  }
}

/** Fotogramas braille para el indicador de trabajo. */
export const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
