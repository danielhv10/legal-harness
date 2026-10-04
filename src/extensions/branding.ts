import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { highlightLegalMarkdown } from "../lib/markdown-legal.js";
import { BRAILLE_FRAMES, DEFAULT_WORKING_MESSAGE, workingMessageFor } from "../lib/ui-format.js";
import { pickWordmarkScale, wordmarkLines } from "../lib/wordmark.js";
import { state } from "../state.js";
import { letradoVersion } from "../version.js";
import {
  boxed,
  contextBar,
  contextLevel,
  formatTokens,
  formatUsd,
  pickFitting,
  shortenPath,
  threeColumns,
} from "./ui.js";

function sessionTotals(ctx: ExtensionContext): { input: number; output: number; cost: number } {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    input += usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    output += usage.output;
    cost += usage.cost?.total ?? 0;
  }
  return { input, output, cost };
}

function fechaActual(): string {
  const d = new Date();
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const meses = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const iso = d.toISOString().slice(0, 10);
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()} (${iso})`;
}

const NIVELES: Record<string, string> = {
  off: "sin razonamiento",
  minimal: "mínimo",
  low: "bajo",
  medium: "medio",
  high: "alto",
  xhigh: "muy alto",
  max: "máximo",
};

function nivelRazonamiento(ctx: ExtensionContext): string {
  const level = ctx.thinkingLevel;
  if (!level) return "—";
  return NIVELES[level] ?? level;
}

/** Estado de las fuentes jurídicas (servidor MCP) a partir de las herramientas registradas. */
function fuentesStatus(pi: ExtensionAPI): { connected: boolean; count: number } {
  try {
    const count = pi.getAllTools().filter((t) => t.name.startsWith("mcp__")).length;
    return { connected: count > 0, count };
  } catch {
    return { connected: false, count: 0 };
  }
}

const HEADER_MAX_WIDTH = 100;

const TIPS = [
  "Pregunta en lenguaje natural o abre un expediente con /expediente <dir>",
  "Herramientas: PDF, Word, web y fuentes jurídicas con citas verificadas (/citas)",
  "Ctrl+C interrumpe · ! ejecuta shell · /ayuda muestra los comandos",
];

const COMANDOS: Array<[string, string]> = [
  ["/login", "iniciar sesión en un proveedor (suscripción o API)"],
  ["/model", "elegir el modelo"],
  ["/expediente <dir>", "abrir un expediente (directorio de trabajo)"],
  ["/citas", "estado y guardarraíl de citas verificadas"],
  ["/dictamen <cuestión>", "redactar un dictamen con fuentes"],
  ["/resumen-expediente", "resumir los documentos del expediente"],
  ["/comparar-versiones a b", "comparar dos versiones de un documento"],
  ["/letrado", "versión, configuración y estado"],
  ["/suscripcion", "información sobre suscripciones y coste"],
  ["/mcp", "estado del servidor de fuentes jurídicas"],
  ["/settings", "ajustes (tema, pantalla completa…)"],
  ["/export", "exportar la conversación a HTML"],
];

function headerLines(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  theme: Theme,
  version: string,
  width: number,
): string[] {
  const narrow = width < 70;
  const sep = theme.fg("dim", " · ");
  const label = (s: string) => theme.fg("muted", s);

  // Logotipo en letras de bloque cuando cabe; si no, el nombre en texto.
  const innerForLogo = Math.min(width, HEADER_MAX_WIDTH) - 4;
  const scale = narrow ? null : pickWordmarkScale(innerForLogo);
  const tagline = `${theme.fg("dim", `v${version}`)}  ${theme.fg("muted", "agente jurídico de terminal")}`;
  const wordmarkRows = scale
    ? [...wordmarkLines("LETRADO", scale).map((row) => theme.fg("accent", row)), tagline, ""]
    : [`${theme.fg("accent", theme.bold("letrado"))} ${tagline}`];

  const modelo = ctx.model ? theme.fg("text", ctx.model.id) : theme.fg("warning", "sin modelo · /login");
  const razonamiento = theme.fg("text", nivelRazonamiento(ctx));
  const expediente = state.expediente.name
    ? theme.fg("accent", state.expediente.name)
    : theme.fg("dim", "ninguno");
  const fuentes = fuentesStatus(pi);
  const fuentesText = fuentes.connected
    ? theme.fg(
        "success",
        `conectadas (${fuentes.count} ${fuentes.count === 1 ? "herramienta" : "herramientas"})`,
      )
    : theme.fg("dim", "sin conectar · /mcp");

  const statusA = `${label("modelo")} ${modelo}${sep}${label("razonamiento")} ${razonamiento}`;
  const statusB = `${label("expediente")} ${expediente}${sep}${label("fuentes:")} ${fuentesText}`;

  // Fila de estado en una sola línea si cabe en el interior del recuadro; si no, en dos.
  const inner = Math.min(width, HEADER_MAX_WIDTH) - 4;
  const statusRow = `${statusA}${sep}${statusB}`;
  const statusRows = visibleWidth(statusRow) <= inner ? [statusRow] : [statusA, statusB];
  const body = narrow
    ? [...wordmarkRows, ...statusRows, "", theme.fg("dim", TIPS[2] ?? "")]
    : [...wordmarkRows, ...statusRows, "", ...TIPS.map((t) => theme.fg("dim", t))];

  if (width < 40) return body;
  return boxed(width, body, theme, { maxWidth: HEADER_MAX_WIDTH, borderColor: "border" });
}

export function brandingExtension(pi: ExtensionAPI): void {
  const version = letradoVersion();

  const applyWorkingIndicator = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    ctx.ui.setWorkingIndicator({
      frames: BRAILLE_FRAMES.map((f) => theme.fg("accent", f)),
      intervalMs: 80,
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const cwdName = basename(ctx.cwd) || ctx.cwd;
    ctx.ui.setTitle(`letrado – ${cwdName}`);
    ctx.ui.setWorkingMessage(DEFAULT_WORKING_MESSAGE);
    ctx.ui.setHiddenThinkingLabel("Razonando…");
    applyWorkingIndicator(ctx);

    ctx.ui.setHeader((tui, theme) => {
      const onState = () => tui.requestRender();
      state.on("change", onState);
      return {
        render(width: number) {
          return ["", ...headerLines(pi, ctx, theme, version, width), ""];
        },
        invalidate() {},
        dispose() {
          state.off("change", onState);
        },
      };
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
      const onState = () => tui.requestRender();
      state.on("change", onState);
      return {
        render(width: number) {
          const totals = sessionTotals(ctx);
          const left = `${theme.fg("dim", "↑")}${formatTokens(totals.input)} ${theme.fg("dim", "↓")}${formatTokens(totals.output)} ${theme.fg("muted", formatUsd(totals.cost))}`;

          const exp = state.expediente.name
            ? theme.fg("accent", `⚖ ${state.expediente.name}`)
            : theme.fg("dim", "sin expediente");
          const citas =
            state.citationsServed > 0
              ? ` ${theme.fg("success", `✓ ${state.citationsServed} citas`)}${state.citationsStripped ? theme.fg("warning", ` · ${state.citationsStripped} eliminadas`) : ""}`
              : "";
          const center = `${exp}${citas}`;

          const sep = theme.fg("dim", " · ");
          const model = ctx.model
            ? `${theme.fg("dim", `${ctx.model.provider}/`)}${theme.fg("muted", ctx.model.id)}`
            : theme.fg("warning", "sin modelo");
          const razonamiento = `${theme.fg("dim", "razonamiento")} ${theme.fg("muted", nivelRazonamiento(ctx))}`;
          const usage = ctx.getContextUsage();
          const percent = usage?.percent ?? null;
          const ctxFull =
            percent === null
              ? ""
              : `${theme.fg("dim", "ctx")} ${theme.fg(contextLevel(percent), contextBar(percent))} ${theme.fg("muted", `${Math.round(percent)}%`)}`;
          const ctxShort =
            percent === null
              ? ""
              : `${theme.fg("dim", "ctx")} ${theme.fg(contextLevel(percent), `${Math.round(percent)}%`)}`;
          const branch = footerData.getGitBranch();
          const place = `${theme.fg("dim", shortenPath(ctx.cwd))}${branch ? theme.fg("dim", ` (${branch})`) : ""}`;

          const join = (parts: string[]) => parts.filter((p) => p.length > 0).join(sep);
          // De más a menos detalle; se elige la primera variante que cabe junto a tokens y expediente.
          const right = pickFitting(width, left, center, [
            `${join([model, razonamiento, ctxFull])} ${place}`,
            join([model, razonamiento, ctxFull]),
            join([model, ctxFull]),
            join([model, ctxShort]),
            model,
          ]);

          const statuses = [...footerData.getExtensionStatuses().values()].join(" · ");
          const line1 = threeColumns(width, left, center, right);
          return statuses ? [line1, theme.fg("dim", statuses)] : [line1];
        },
        invalidate() {},
        dispose() {
          unsubBranch();
          state.off("change", onState);
        },
      };
    });
  });

  // Verbos de trabajo según la herramienta en ejecución.
  pi.on("tool_execution_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage(workingMessageFor(event.toolName));
  });
  pi.on("tool_execution_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage(DEFAULT_WORKING_MESSAGE);
  });
  pi.on("agent_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage(DEFAULT_WORKING_MESSAGE);
  });

  // Fecha actual como sección estable del system prompt (cambia una vez al día).
  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections.fecha = `Fecha actual: ${fechaActual()}. Úsala para cómputo de plazos y para valorar la vigencia temporal.`;
  });

  // Realce visual de Roj/ECLI, DEROGADO y fechas de modificación en las respuestas (solo renderizado).
  pi.registerMarkdownTransformer((markdown, context) =>
    context.messageType === "assistant" ? highlightLegalMarkdown(markdown) : markdown,
  );

  pi.registerCommand("letrado", {
    description: "Información de letrado: versión, directorio de configuración y estado",
    handler: async (_args, ctx) => {
      const fuentes = fuentesStatus(pi);
      const text = [
        `letrado v${version}`,
        `Configuración: ${process.env.PI_CODING_AGENT_DIR}`,
        `Modelo: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "ninguno (usa /login y /model)"}`,
        `Razonamiento: ${nivelRazonamiento(ctx)}`,
        `Expediente: ${state.expediente.dir ?? "ninguno (/expediente <dir>)"}`,
        `Fuentes jurídicas: ${fuentes.connected ? `conectadas (${fuentes.count} herramientas)` : "sin conectar"} · /mcp para detalles`,
      ].join("\n");
      ctx.ui.notify(text, "info");
    },
  });

  pi.registerCommand("ayuda", {
    description: "Lista los comandos de letrado",
    handler: async (_args, ctx) => {
      const widest = Math.max(...COMANDOS.map(([c]) => c.length));
      const text = [
        "Comandos de letrado:",
        ...COMANDOS.map(([c, d]) => `  ${c.padEnd(widest)}  ${d}`),
        "",
        "Atajos: Ctrl+C interrumpe · ! <comando> ejecuta shell · Ctrl+E despliega la salida de una herramienta",
      ].join("\n");
      ctx.ui.notify(text, "info");
    },
  });
}
