import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { estadoPlazo, formatPlazo, nextPlazo, type Plazo, parsePlazos } from "../lib/plazos.js";
import { state } from "../state.js";

const WIDGET_KEY = "letrado-expediente";
const READ_TOOLS = new Set(["read", "read_pdf", "read_docx"]);

/**
 * Widget de expediente encima del editor:
 *   ⚖ García c. Constructora · próximo plazo: 12/10/2026 — contestación · documentos leídos: 3
 * Se oculta (0 líneas) cuando no hay expediente activo.
 */
class ExpedienteWidget {
  private cachedSource?: string;
  private cachedPlazos: Plazo[] = [];
  private readonly onChange = () => this.tui.requestRender();

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
  ) {
    state.on("change", this.onChange);
  }

  private plazos(): Plazo[] {
    const src = state.expediente.instructions;
    if (src !== this.cachedSource) {
      this.cachedSource = src;
      this.cachedPlazos = parsePlazos(src);
    }
    return this.cachedPlazos;
  }

  render(width: number): string[] {
    if (!state.expediente.dir) return [];
    const th = this.theme;
    const sep = th.fg("dim", " · ");
    const name = th.fg("accent", `⚖ ${state.expediente.name ?? "expediente"}`);

    const parts: string[] = [];
    const plazo = nextPlazo(this.plazos());
    if (plazo) {
      const estado = estadoPlazo(plazo);
      const color = estado === "pasado" ? "error" : estado === "inminente" ? "warning" : "text";
      const label = estado === "pasado" ? "plazo vencido: " : "próximo plazo: ";
      parts.push(th.fg("muted", label) + th.fg(color, formatPlazo(plazo)));
    }
    parts.push(th.fg("muted", "documentos leídos: ") + th.fg("text", String(state.documentsRead.size)));

    const oneLine = [name, ...parts].join(sep);
    if (visibleWidth(oneLine) <= width - 2) return [truncateToWidth(` ${oneLine}`, width)];
    return [truncateToWidth(` ${name}`, width), truncateToWidth(`   ${parts.join(sep)}`, width)];
  }

  invalidate(): void {
    this.cachedSource = undefined;
  }

  dispose(): void {
    state.off("change", this.onChange);
  }
}

export function widgetsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    state.resetDocumentsRead();
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => new ExpedienteWidget(tui, theme), {
      placement: "aboveEditor",
    });
  });

  pi.on("tool_result", async (event) => {
    if (event.isError || !READ_TOOLS.has(event.toolName)) return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path === "string") state.addDocumentRead(path);
  });
}
