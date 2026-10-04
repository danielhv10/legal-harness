import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  applyAccion,
  currentIndex,
  formatTareasText,
  summarizeTareas,
  type Tarea,
  type TareasAccion,
  WIDGET_MAX_ITEMS,
} from "../lib/tareas.js";
import { state } from "../state.js";

const ENTRY_TYPE = "letrado-tareas";
const WIDGET_KEY = "letrado-tareas";

interface TareasEntry {
  items: Tarea[];
}

interface TareasDetails {
  accion: TareasAccion;
  items: Tarea[];
  error?: string;
}

const ACCIONES: readonly TareasAccion[] = ["definir", "completar", "añadir", "limpiar"];

const tareasSchema = Type.Object({
  // `enum` de cadenas (no anyOf/const) por compatibilidad con proveedores como Google.
  accion: Type.Unsafe<TareasAccion>({
    type: "string",
    enum: [...ACCIONES],
    description:
      "definir: sustituye la lista completa · completar: marca una tarea (indice) · añadir: anexa tareas · limpiar: vacía la lista",
  }),
  tareas: Type.Optional(
    Type.Array(Type.String(), { description: "Tareas en orden (para definir y añadir), breves y concretas" }),
  ),
  indice: Type.Optional(
    Type.Integer({ minimum: 1, description: "Número de la tarea a completar, empezando en 1" }),
  ),
});

/** Widget encima del editor: lista compacta con la tarea en curso resaltada. */
class TareasWidget {
  private readonly onChange = () => this.tui.requestRender();

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
  ) {
    state.on("change", this.onChange);
  }

  render(width: number): string[] {
    const items = state.tareas;
    if (items.length === 0) return [];
    const th = this.theme;
    const current = currentIndex(items);
    const lines: string[] = [];
    const shown = items.slice(0, WIDGET_MAX_ITEMS);
    shown.forEach((t, i) => {
      let line: string;
      if (t.done) line = th.fg("dim", `☑ ${t.text}`);
      else if (i === current) line = th.fg("accent", `☐ ${t.text}`);
      else line = `${th.fg("muted", "☐ ")}${th.fg("text", t.text)}`;
      lines.push(truncateToWidth(` ${line}`, width));
    });
    if (items.length > shown.length) {
      lines.push(truncateToWidth(` ${th.fg("dim", `+${items.length - shown.length} más`)}`, width));
    }
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    state.off("change", this.onChange);
  }
}

export function tareasExtension(pi: ExtensionAPI): void {
  let items: Tarea[] = [];

  function commit(next: Tarea[], persist = true): void {
    items = next;
    state.setTareas(items);
    if (persist) pi.appendEntry(ENTRY_TYPE, { items } satisfies TareasEntry);
  }

  /** Reconstruye la lista desde la rama activa (la última entrada gana). */
  function rebuild(ctx: ExtensionContext): void {
    let found: Tarea[] = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
        const data = entry.data as TareasEntry | undefined;
        if (Array.isArray(data?.items))
          found = data.items.map((t) => ({ text: String(t.text), done: !!t.done }));
      }
    }
    commit(found, false);
  }

  pi.on("session_start", async (_event, ctx) => {
    rebuild(ctx);
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => new TareasWidget(tui, theme), { placement: "aboveEditor" });
  });
  pi.on("session_tree", async (_event, ctx) => rebuild(ctx));

  pi.registerTool<typeof tareasSchema, TareasDetails>({
    name: "tareas",
    label: "Tareas",
    description:
      "Lista de tareas visible para el usuario, para trabajos de varios pasos (dictámenes, redacción de escritos, revisión de un expediente). " +
      "Al empezar un encargo complejo, usa `definir` con los pasos en orden; marca cada paso con `completar` en cuanto lo termines (índice 1-based); " +
      "usa `añadir` si surgen pasos nuevos y `limpiar` al cerrar el encargo. Mantén la lista al día: el usuario la ve en pantalla.",
    promptSnippet:
      "tareas: lista de tareas visible para el usuario; úsala en trabajos de varios pasos y mantenla actualizada (definir/completar/añadir/limpiar)",
    promptGuidelines: [
      "Para encargos de varios pasos (dictámenes, redacción, revisión de expedientes) define las tareas con la herramienta `tareas` y ve completándolas según avanzas.",
    ],
    parameters: tareasSchema,
    exposure: "direct",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params) {
      const result = applyAccion(items, params);
      if (result.error) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}\n\n${formatTareasText(items)}` }],
          details: { accion: params.accion, items: [...items], error: result.error },
          isError: true,
        };
      }
      commit(result.items);
      const text = `${summarizeTareas(items)}\n${formatTareasText(items)}`;
      return { content: [{ type: "text", text }], details: { accion: params.accion, items: [...items] } };
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("tareas ")) + theme.fg("muted", args.accion);
      if (args.accion === "completar" && args.indice !== undefined) {
        text += ` ${theme.fg("accent", `#${args.indice}`)}`;
      } else if (args.tareas?.length) {
        text += ` ${theme.fg("dim", `(${args.tareas.length})`)}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      let text = theme.fg("success", "✓ ") + theme.fg("muted", summarizeTareas(details.items));
      if (expanded) {
        const current = currentIndex(details.items);
        details.items.forEach((t, i) => {
          const mark = t.done ? theme.fg("success", "☑") : theme.fg("dim", "☐");
          const body = t.done ? theme.fg("dim", t.text) : i === current ? theme.fg("accent", t.text) : t.text;
          text += `\n${mark} ${body}`;
        });
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerCommand("tareas", {
    description: "Muestra la lista de tareas del modelo · /tareas limpiar la vacía",
    getArgumentCompletions: (prefix) =>
      ["limpiar"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "limpiar") {
        commit([]);
        ctx.ui.notify("Lista de tareas vaciada.", "info");
        return;
      }
      if (items.length === 0) {
        ctx.ui.notify(
          "Sin tareas. El modelo las define con la herramienta `tareas` en encargos largos.",
          "info",
        );
        return;
      }
      ctx.ui.notify(`${summarizeTareas(items)}\n${formatTareasText(items)}`, "info");
    },
  });
}
