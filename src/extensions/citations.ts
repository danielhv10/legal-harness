import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type { StrippedCitation } from "../lib/citations/diff.js";
import { applyGuard } from "../lib/citations/guard.js";
import {
  dedupeServed,
  emptyAllowed,
  extractSessionState,
  harvestFromToolResult,
  mergeAllowed,
  type ServedCitation,
  urlsFromWebFetch,
  urlsFromWebSearch,
} from "../lib/citations/harvest.js";
import type { AllowedCitations } from "../lib/citations/sanitize-citations.js";
import { state } from "../state.js";

/**
 * Guardarraíl de integridad de citas.
 *
 * Mantiene por sesión la lista blanca de lo que las herramientas han servido
 * (MCP jurídico y `web_fetch`), sanea cada mensaje del asistente en
 * `message_end`, avisa de lo eliminado en `agent_end` y expone `/citas`.
 * Además reinyecta `session_state`/`history` en llamadas sucesivas a `research`.
 */

interface CitationStore {
  allowed: AllowedCitations;
  served: ServedCitation[];
  webUrls: Set<string>;
  stripped: StrippedCitation[];
  lastResearchState?: unknown;
  enabled: boolean;
}

const RESEARCH_STATE_ENTRY = "letrado-research-state";
const CITAS_MESSAGE = "letrado-citas";
const HISTORY_TURNS = 6;
const HISTORY_MAX_CHARS = 2000;

const store: CitationStore = {
  allowed: emptyAllowed(),
  served: [],
  webUrls: new Set(),
  stripped: [],
  enabled: true,
};

/** Solo para tests: acceso de lectura al store. */
export function getCitationStore(): Readonly<CitationStore> {
  return store;
}

function resetStore(): void {
  store.allowed = emptyAllowed();
  store.served = [];
  store.webUrls = new Set();
  store.stripped = [];
  store.lastResearchState = undefined;
}

function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function isResearchTool(name: string): boolean {
  return isMcpTool(name) && name.endsWith("__research");
}

function allowSearchUrls(pi: ExtensionAPI): boolean {
  // Clave propia fuera del esquema de Pi: settings.json → { "letrado": { "citations": { "allowSearchUrls": true } } }
  const settings = pi.getSettings() as unknown as { letrado?: { citations?: { allowSearchUrls?: unknown } } };
  return settings?.letrado?.citations?.allowSearchUrls === true;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text",
    )
    .map((c) => c.text)
    .join("\n");
}

function ingestToolResult(
  pi: ExtensionAPI,
  toolName: string,
  content: Array<{ type: string; text?: string }>,
  structuredContent: unknown,
  details: unknown,
  isError: boolean,
): void {
  if (isError) return;
  if (isMcpTool(toolName)) {
    const { allowed, served } = harvestFromToolResult(toolName, content, structuredContent);
    store.allowed = mergeAllowed(store.allowed, allowed);
    store.served = dedupeServed([...store.served, ...served]);
    if (isResearchTool(toolName)) {
      const sessionState = extractSessionState(structuredContent);
      if (sessionState !== undefined) store.lastResearchState = sessionState;
    }
    return;
  }
  if (toolName === "web_fetch") {
    for (const url of urlsFromWebFetch(details)) {
      store.webUrls.add(url);
      store.served.push({ label: url, url, source: "web" });
    }
    store.served = dedupeServed(store.served);
    return;
  }
  if (toolName === "web_search" && allowSearchUrls(pi)) {
    for (const url of urlsFromWebSearch(details)) store.webUrls.add(url);
  }
}

function refreshStatus(ctx: ExtensionContext): void {
  state.setCitationCounts(store.served.length, store.stripped.length);
  if (!ctx.hasUI) return;
  const served = store.served.length;
  const text = !store.enabled
    ? "citas: guardarraíl desactivado"
    : served > 0
      ? `✓ ${served} citas verificadas${store.stripped.length ? ` · ${store.stripped.length} eliminadas` : ""}`
      : undefined;
  ctx.ui.setStatus("citas", text);
}

/** Reconstruye el store a partir de la rama activa de la sesión (tras resume/fork/reload). */
function rebuildFromSession(pi: ExtensionAPI, ctx: ExtensionContext): void {
  resetStore();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === RESEARCH_STATE_ENTRY) {
      store.lastResearchState = entry.data;
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    // Los mensajes `toolResult` persistidos no conservan `structuredContent`; se cosecha del texto.
    ingestToolResult(pi, msg.toolName, msg.content, undefined, msg.details, msg.isError);
  }
}

/** Últimos turnos user/assistant en texto plano para `research.history`. */
function buildHistory(ctx: ExtensionContext): Array<{ role: "user" | "assistant"; content: string }> {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = textOf(msg.content).trim();
    if (!text) continue;
    turns.push({
      role: msg.role,
      content: text.length > HISTORY_MAX_CHARS ? `${text.slice(0, HISTORY_MAX_CHARS)}…` : text,
    });
  }
  return turns.slice(-HISTORY_TURNS);
}

function formatCitation(c: ServedCitation): string {
  const parts: string[] = [];
  parts.push(c.url ? `[${c.label}](${c.url})` : c.label);
  const ids = [c.roj ? `Roj: ${c.roj}` : undefined, c.ecli ? `ECLI: ${c.ecli}` : undefined].filter(Boolean);
  if (ids.length) parts.push(`(${ids.join(" · ")})`);
  if (c.date) parts.push(`— ${c.date}`);
  let line = `- ${parts.join(" ")}`;
  if (c.vigencia) line += `\n  Vigencia: ${c.vigencia}`;
  return line;
}

function formatStripped(s: StrippedCitation): string {
  switch (s.kind) {
    case "url":
      return `- Enlace eliminado: ${s.label ? `"${s.label}" → ` : ""}${s.value}`;
    case "roj":
      return `- Roj no servido: ${s.value}`;
    case "ecli":
      return `- ECLI no servido: ${s.value}`;
  }
}

export function renderCitasReport(): string {
  const mcp = store.served.filter((c) => c.source === "mcp");
  const web = store.served.filter((c) => c.source === "web");
  const lines: string[] = [];
  lines.push(`**Citas de la sesión** — guardarraíl ${store.enabled ? "activo" : "desactivado (/citas on)"}`);
  lines.push("");
  lines.push(`**Fuentes jurídicas (${mcp.length})**`);
  lines.push(
    mcp.length
      ? mcp.map(formatCitation).join("\n")
      : "_Ninguna todavía: las herramientas de búsqueda jurídica aún no han devuelto documentos._",
  );
  lines.push("");
  lines.push(`**Web consultada (${web.length})**`);
  lines.push(
    web.length
      ? web.map(formatCitation).join("\n")
      : "_Ninguna (solo cuentan las páginas leídas con web_fetch)._",
  );
  lines.push("");
  lines.push(`**Citas no verificadas eliminadas (${store.stripped.length})**`);
  lines.push(store.stripped.length ? store.stripped.map(formatStripped).join("\n") : "_Ninguna._");
  return lines.join("\n");
}

export function citationsExtension(pi: ExtensionAPI): void {
  let strippedThisRun = 0;

  // Entrada de sesión (no se envía al modelo): el informe de citas es para el usuario.
  pi.registerEntryRenderer<{ report: string }>(CITAS_MESSAGE, (entry) => {
    return new Markdown(entry.data?.report ?? "", 1, 0, getMarkdownTheme());
  });

  pi.on("session_start", async (_event, ctx) => {
    rebuildFromSession(pi, ctx);
    refreshStatus(ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    const details = "details" in event ? (event as { details?: unknown }).details : undefined;
    ingestToolResult(pi, event.toolName, event.content, event.structuredContent, details, event.isError);
    if (isResearchTool(event.toolName) && !event.isError && store.lastResearchState !== undefined) {
      const fresh = extractSessionState(event.structuredContent);
      if (fresh !== undefined) pi.appendEntry(RESEARCH_STATE_ENTRY, fresh);
    }
    refreshStatus(ctx);
  });

  // Multi-turno de `research`: reinyectar estado e historial si el modelo no los pasó.
  pi.on("tool_call", async (event, ctx) => {
    if (!isResearchTool(event.toolName)) return;
    const input = event.input as Record<string, unknown>;
    if (input.session_state === undefined && store.lastResearchState !== undefined) {
      input.session_state = store.lastResearchState;
    }
    if (input.history === undefined) {
      const history = buildHistory(ctx);
      if (history.length) input.history = history;
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!store.enabled) return;
    const message = event.message;
    if (message.role !== "assistant") return;
    let changed = false;
    const newStripped: StrippedCitation[] = [];
    const content = message.content.map((block) => {
      if (block.type !== "text") return block;
      const result = applyGuard(block.text, store.allowed, store.webUrls);
      if (result.text === block.text) return block;
      changed = true;
      newStripped.push(...result.stripped);
      return { ...block, text: result.text };
    });
    if (!changed) return;
    if (newStripped.length) {
      store.stripped.push(...newStripped);
      strippedThisRun += newStripped.length;
      refreshStatus(ctx);
    }
    return { message: { ...message, content } };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (strippedThisRun > 0 && ctx.hasUI) {
      ctx.ui.notify(`Citas no verificadas eliminadas: ${strippedThisRun} (ver /citas)`, "warning");
    }
    strippedThisRun = 0;
    refreshStatus(ctx);
  });

  pi.registerCommand("citas", {
    description: "Citas servidas y eliminadas en la sesión · /citas off|on desactiva o activa el guardarraíl",
    getArgumentCompletions: (prefix) =>
      ["on", "off"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "off" || arg === "on") {
        store.enabled = arg === "on";
        refreshStatus(ctx);
        ctx.ui.notify(
          store.enabled
            ? "Guardarraíl de citas activado: se eliminarán enlaces y Roj/ECLI no servidos por las herramientas."
            : "Guardarraíl de citas desactivado: las citas se mostrarán sin verificar (solo para depuración).",
          store.enabled ? "info" : "warning",
        );
        return;
      }
      pi.appendEntry(CITAS_MESSAGE, { report: renderCitasReport() });
    },
  });
}
