import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { highlightLegalMarkdown } from "../lib/markdown-legal.js";
import { state } from "../state.js";
import { letradoVersion } from "../version.js";
import { formatTokens, formatUsd, lines, shortenPath, threeColumns } from "./ui.js";

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

export function brandingExtension(pi: ExtensionAPI): void {
  const version = letradoVersion();

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const cwdName = basename(ctx.cwd) || ctx.cwd;
    ctx.ui.setTitle(`letrado – ${cwdName}`);
    ctx.ui.setWorkingMessage("Analizando…");
    ctx.ui.setHiddenThinkingLabel("Razonando…");

    ctx.ui.setHeader((_tui, theme) =>
      lines(() => [
        "",
        `${theme.fg("accent", theme.bold("letrado"))} ${theme.fg("dim", `v${version}`)}  ${theme.fg("muted", "agente jurídico de terminal")}`,
        theme.fg(
          "dim",
          "Ctrl+C interrumpir · / comandos · ! bash · /expediente <dir> · /citas · /login suscripción",
        ),
        theme.fg("muted", "Fuentes: BOE · CENDOJ · TEAC/DGT/AEPD/CNMC · documentos locales · web"),
        "",
      ]),
    );

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
          const model = ctx.model ? `${ctx.model.id}` : "sin modelo";
          const branch = footerData.getGitBranch();
          const right = `${theme.fg("muted", model)} ${theme.fg("dim", shortenPath(ctx.cwd))}${branch ? theme.fg("dim", ` (${branch})`) : ""}`;
          const statuses = [...footerData.getExtensionStatuses().values()].join(" · ");
          const line1 = threeColumns(width, left, `${exp}${citas}`, right);
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
      const text = [
        `letrado v${version}`,
        `Configuración: ${process.env.PI_CODING_AGENT_DIR}`,
        `Modelo: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "ninguno (usa /login y /model)"}`,
        `Expediente: ${state.expediente.dir ?? "ninguno (/expediente <dir>)"}`,
        "Fuentes jurídicas: /mcp para ver el estado del servidor",
      ].join("\n");
      ctx.ui.notify(text, "info");
    },
  });
}
