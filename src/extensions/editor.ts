import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { state } from "../state.js";

const HINT = " Enter envía · Shift+Enter nueva línea · /ayuda ";

const THINKING_LABELS: Record<string, string> = {
  off: "sin razonamiento",
  minimal: "razonamiento mínimo",
  low: "razonamiento bajo",
  medium: "razonamiento medio",
  high: "razonamiento alto",
  xhigh: "razonamiento muy alto",
  max: "razonamiento máximo",
};

/**
 * Borde horizontal con texto a la izquierda y a la derecha; recorta primero la derecha
 * y luego la izquierda hasta que quepan con un hueco mínimo.
 */
function fitBorder(left: string, right: string, width: number, border: (text: string) => string): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");
  let l = left;
  let r = right;
  const fixed = 2;
  const minGap = 3;
  while (fixed + visibleWidth(l) + visibleWidth(r) + minGap > width && visibleWidth(r) > 0) {
    r = truncateToWidth(r, Math.max(0, visibleWidth(r) - 1), "");
  }
  while (fixed + visibleWidth(l) + visibleWidth(r) + minGap > width && visibleWidth(l) > 0) {
    l = truncateToWidth(l, Math.max(0, visibleWidth(l) - 1), "");
  }
  const gap = Math.max(0, width - fixed - visibleWidth(l) - visibleWidth(r));
  return `${border("─")}${l}${border("─".repeat(gap))}${r}${border("─")}`;
}

export function editorExtension(pi: ExtensionAPI): void {
  let lastCtx: ExtensionContext | undefined;
  let activeTui: TUI | undefined;
  /** Preferencia del usuario (/editor clasico) mientras dure el proceso. */
  let useClassic = false;
  let listening = false;

  function themeFor(ctx: ExtensionContext) {
    return ctx.ui.theme;
  }

  function statusText(ctx: ExtensionContext): string {
    const th = themeFor(ctx);
    if (!state.expediente.dir) return th.fg("muted", " letrado ");
    const model = ctx.model?.id ?? "sin modelo";
    const level = (ctx.thinkingLevel ?? pi.getThinkingLevel()) as string;
    const thinking = THINKING_LABELS[level] ?? `razonamiento ${level}`;
    const name = th.fg("accent", `⚖ ${state.expediente.name ?? "expediente"}`);
    return ` ${name}${th.fg("muted", ` · ${model} · ${thinking} `)}`;
  }

  class LetradoEditor extends CustomEditor {
    private working = false;

    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
      super(tui, theme, keybindings, { embedWorkingStatus: true });
      activeTui = tui;
    }

    override setWorkingStatusIndicator(
      indicator: Parameters<CustomEditor["setWorkingStatusIndicator"]>[0],
    ): void {
      super.setWorkingStatusIndicator(indicator);
      this.working = indicator !== undefined;
    }

    private frame(text: string): string {
      const ctx = lastCtx;
      if (!ctx) return this.borderColor(text);
      return themeFor(ctx).fg(state.expediente.dir ? "borderAccent" : "border", text);
    }

    protected override renderTopBorder(width: number, hiddenLineCount: number): string {
      const ctx = lastCtx;
      if (this.working || !ctx) {
        // Deja que CustomEditor pinte el indicador de trabajo, pero con nuestro color de borde.
        const saved = this.borderColor;
        this.borderColor = (t) => this.frame(t);
        try {
          return super.renderTopBorder(width, hiddenLineCount);
        } finally {
          this.borderColor = saved;
        }
      }
      const right = hiddenLineCount > 0 ? themeFor(ctx).fg("muted", ` ↑ ${hiddenLineCount} más `) : "";
      return fitBorder(statusText(ctx), right, width, (t) => this.frame(t));
    }

    protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
      const ctx = lastCtx;
      const left = hiddenLineCount > 0 && ctx ? themeFor(ctx).fg("muted", ` ↓ ${hiddenLineCount} más `) : "";
      const hint =
        ctx && width >= visibleWidth(HINT) + visibleWidth(left) + 8 ? themeFor(ctx).fg("dim", HINT) : "";
      return fitBorder(left, hint, width, (t) => this.frame(t));
    }
  }

  function apply(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent(
      useClassic ? undefined : (tui, theme, keybindings) => new LetradoEditor(tui, theme, keybindings),
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    if (!listening) {
      listening = true;
      state.on("change", () => activeTui?.requestRender());
    }
    apply(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    lastCtx = ctx;
    activeTui?.requestRender();
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    lastCtx = ctx;
    activeTui?.requestRender();
  });

  pi.on("session_shutdown", async () => {
    activeTui = undefined;
  });

  pi.registerCommand("editor", {
    description: "Editor de entrada: /editor letrado (borde con estado) · /editor clasico",
    getArgumentCompletions: (prefix) =>
      ["letrado", "clasico"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase().replace("á", "a");
      if (arg !== "letrado" && arg !== "clasico") {
        ctx.ui.notify(
          `Editor actual: ${useClassic ? "clasico" : "letrado"}. Usa /editor letrado|clasico`,
          "info",
        );
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("El editor solo se puede cambiar en modo interactivo.", "warning");
        return;
      }
      useClassic = arg === "clasico";
      lastCtx = ctx;
      apply(ctx);
      ctx.ui.notify(useClassic ? "Editor clásico de Pi." : "Editor letrado: estado en el borde.", "info");
    },
  });
}
