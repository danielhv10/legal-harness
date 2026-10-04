import type {
  ExtensionAPI,
  Theme,
  ToolRenderers,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  countResults,
  describeCall,
  summarizeBash,
  summarizeEdit,
  summarizeError,
  summarizeRead,
  summarizeWrite,
} from "../lib/tool-summaries.js";

type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/** Herramientas integradas de Pi con renderizado compacto en español. */
const COMPACT_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

interface RenderableResult {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

interface TruncationLike {
  truncated: boolean;
  totalLines?: number;
}

function textOf(result: RenderableResult): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function truncationOf(details: unknown): TruncationLike | undefined {
  if (!details || typeof details !== "object") return undefined;
  const t = (details as { truncation?: unknown }).truncation;
  if (!t || typeof t !== "object") return undefined;
  const tt = t as { truncated?: unknown; totalLines?: unknown };
  return {
    truncated: tt.truncated === true,
    totalLines: typeof tt.totalLines === "number" ? tt.totalLines : undefined,
  };
}

function summarize(toolName: string, result: RenderableResult, isPartial: boolean, theme: Theme): string {
  const text = textOf(result);
  const truncation = truncationOf(result.details);
  switch (toolName) {
    case "read":
      return summarizeRead(text, truncation);
    case "bash":
      return isPartial ? `ejecutando… ${summarizeBash(text)}` : summarizeBash(text, truncation);
    case "edit": {
      const details = (result.details ?? {}) as { diff?: string; patch?: string };
      const summary = summarizeEdit(details.diff, details.patch);
      const m = /^\+(\d+) −(\d+) líneas$/.exec(summary);
      if (!m) return summary;
      return `${theme.fg("success", `+${m[1]}`)} ${theme.fg("error", `−${m[2]}`)} ${theme.fg("dim", "líneas")}`;
    }
    case "grep":
    case "find":
    case "ls":
      return countResults(text, truncation);
    default:
      return text ? `${text.split("\n").length} líneas` : "";
  }
}

function compactResult(
  toolName: string,
  result: RenderableResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ToolRenderContext,
): Text {
  if (context.isError) {
    return new Text(theme.fg("error", `⎿ ${summarizeError(textOf(result))}`), 0, 0);
  }
  let summary: string;
  if (toolName === "write") {
    const args = context.args as Record<string, unknown> | undefined;
    const content = typeof args?.content === "string" ? args.content : "";
    summary = summarizeWrite(content);
  } else {
    summary = summarize(toolName, result, options.isPartial, theme);
  }
  if (!summary) return new Text("", 0, 0);
  const prefix = theme.fg("dim", "⎿ ");
  const body = toolName === "edit" ? summary : theme.fg("dim", summary);
  return new Text(`${prefix}${body}`, 0, 0);
}

function renderCallText(toolName: string, args: unknown, theme: Theme, cwd: string): string {
  const desc = describeCall(toolName, (args ?? {}) as Record<string, unknown>, cwd);
  if (!desc) return theme.fg("toolTitle", theme.bold(toolName));
  let text = `${theme.fg("toolTitle", theme.bold(desc.verb))} ${theme.fg("toolTitle", desc.subject)}`;
  if (desc.detail) text += ` ${theme.fg("muted", desc.detail)}`;
  return text;
}

function expandedEdit(result: RenderableResult, theme: Theme, context: ToolRenderContext): Text {
  const details = (result.details ?? {}) as { diff?: string; patch?: string };
  const source = details.diff?.trim() ? details.diff : details.patch;
  const header =
    compactResult("edit", result, { expanded: true, isPartial: false }, theme, context).render(10_000)[0] ??
    "";
  if (!source) return new Text(header, 0, 0);
  return new Text(`${header}\n${renderDiff(source)}`, 0, 0);
}

/**
 * Renderizadores compactos (estilo Claude Code) para las herramientas integradas de Pi.
 * Plegado: una línea de llamada + una línea de resumen `⎿ …`. Desplegado (Ctrl+E / clic):
 * delega en el renderizador original de Pi (salida completa, diffs coloreados).
 */
export function toolRenderersExtension(pi: ExtensionAPI): void {
  pi.registerToolRenderer((toolName, next) => {
    if (!COMPACT_TOOLS.has(toolName)) return next();
    let original: ToolRenderers | undefined;
    try {
      original = next();
    } catch {
      original = undefined;
    }
    const renderers: ToolRenderers = {
      // Nuestros renderizadores no dibujan su propio marco: usamos la tarjeta estándar
      // (toolPendingBg / toolSuccessBg / toolErrorBg) para todas, incluida `edit`.
      renderShell: "default",
      renderCall(args, theme, context) {
        try {
          const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
          text.setText(renderCallText(toolName, args, theme, context.cwd));
          return text;
        } catch {
          const fallback = original?.renderCall;
          if (fallback) return fallback(args, theme, context);
          return new Text(theme.fg("toolTitle", toolName), 0, 0);
        }
      },
      renderResult(result, options, theme, context) {
        const typed = result as unknown as RenderableResult;
        try {
          if (!options.expanded || context.isError) {
            return compactResult(toolName, typed, options, theme, context);
          }
          if (toolName === "edit") return expandedEdit(typed, theme, context);
          const delegate = original?.renderResult;
          if (delegate) {
            // El componente anterior puede ser nuestro `Text` compacto; no se lo pasamos al original.
            return delegate(result, options, theme, { ...context, lastComponent: undefined });
          }
          return new Text(theme.fg("toolOutput", textOf(typed)), 0, 0);
        } catch {
          return new Text(theme.fg("toolOutput", textOf(typed)), 0, 0);
        }
      },
    };
    return renderers;
  });
}
