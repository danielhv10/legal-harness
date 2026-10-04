import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { state } from "../state.js";

export type PermissionAnswer = "once" | "session" | "deny";

const PERMISSION_OPTIONS: Array<{ value: PermissionAnswer; label: string }> = [
  { value: "once", label: "Permitir una vez" },
  { value: "session", label: "Permitir durante esta sesión" },
  { value: "deny", label: "Denegar" },
];
const DETAIL_MAX_CHARS = 200;

function clipDetail(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_MAX_CHARS ? `${flat.slice(0, DETAIL_MAX_CHARS - 1)}…` : flat;
}

/**
 * Diálogo de permiso en overlay (modo TUI): título, detalle (comando o ruta) y
 * las tres opciones. Esc / Ctrl+C = denegar.
 */
class PermissionDialog {
  private readonly list: SelectList;

  constructor(
    private readonly theme: Theme,
    private readonly title: string,
    private readonly detail: string,
    private readonly done: (answer: PermissionAnswer) => void,
  ) {
    this.list = new SelectList(
      PERMISSION_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      PERMISSION_OPTIONS.length,
      getSelectListTheme(),
    );
    this.list.onSelect = (item) => done(item.value as PermissionAnswer);
    this.list.onCancel = () => done("deny");
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("deny");
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    const th = this.theme;
    const w = Math.max(20, width);
    const inner = w - 4;
    const border = (t: string) => th.fg("warning", t);
    const row = (content: string) => {
      const text = truncateToWidth(content, inner, "…");
      const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
      return `${border("│")} ${text}${pad} ${border("│")}`;
    };
    const titleText = th.fg("warning", th.bold(` ${this.title} `));
    const topGap = Math.max(0, w - 2 - visibleWidth(titleText));
    const lines: string[] = [];
    lines.push(`${border("┌")}${titleText}${border("─".repeat(topGap))}${border("┐")}`);
    for (const l of wrapTextWithAnsi(th.fg("text", this.detail), inner)) lines.push(row(l));
    lines.push(row(""));
    for (const l of this.list.render(inner)) lines.push(row(l));
    lines.push(row(th.fg("dim", "↑↓ elegir · Enter confirmar · Esc denegar")));
    lines.push(`${border("└")}${border("─".repeat(w - 2))}${border("┘")}`);
    return lines;
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

/**
 * Pide permiso al usuario. En TUI usa un overlay con `SelectList`; en RPC cae a
 * `ctx.ui.select`. `undefined`/Esc equivale a denegar.
 */
export async function askPermission(
  ctx: ExtensionContext,
  title: string,
  detail: string,
): Promise<PermissionAnswer> {
  const shortDetail = clipDetail(detail);
  if (ctx.mode === "tui") {
    try {
      return await ctx.ui.custom<PermissionAnswer>(
        (_tui, theme, _kb, done) => new PermissionDialog(theme, title, shortDetail, done),
        { overlay: true, overlayOptions: { width: "80%", minWidth: 50, maxHeight: "60%", anchor: "center" } },
      );
    } catch {
      // Si el overlay no está disponible, seguimos con el selector estándar.
    }
  }
  const labels = PERMISSION_OPTIONS.map((o) => o.label);
  const choice = await ctx.ui.select(`${title}\n${shortDetail}`, labels);
  return PERMISSION_OPTIONS.find((o) => o.label === choice)?.value ?? "deny";
}

const DESTRUCTIVE_BASH: Array<{ re: RegExp; label: string }> = [
  {
    re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)\b/,
    label: "borrado recursivo (rm -rf)",
  },
  { re: /\bsudo\b/, label: "elevación de privilegios (sudo)" },
  { re: /\bchmod\s+(-R\s+)?[0-7]*777\b/, label: "permisos 777" },
  { re: /\bchown\s+-R\b/, label: "cambio recursivo de propietario" },
  { re: /\bgit\s+push\s+.*(--force|-f)\b/, label: "git push --force" },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f)/, label: "git reset --hard / git clean" },
  { re: /\bmkfs\b|\bdd\s+if=|>\s*\/dev\/sd/, label: "operación sobre discos" },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, label: "fork bomb" },
  { re: /\b(shutdown|reboot|halt)\b/, label: "apagado del sistema" },
];

const BINARY_EXT = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".odt",
  ".ods",
  ".zip",
  ".rar",
  ".7z",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".mp3",
  ".mp4",
  ".mov",
  ".wav",
  ".eml",
  ".msg",
]);
const OFFICE_EXT = new Set([".pdf", ".docx", ".doc", ".odt"]);

function isBinaryFile(path: string): boolean {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return true;
  if (!existsSync(path)) return false;
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    closeSync(fd);
    return buf.subarray(0, n).includes(0);
  } catch {
    return false;
  }
}

function insideDir(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function allowedRoots(ctx: ExtensionContext): string[] {
  const roots = [ctx.cwd];
  if (state.expediente.dir) roots.push(state.expediente.dir);
  return roots;
}

/**
 * Seguridad: confirma comandos destructivos, protege escrituras fuera del expediente
 * y evita que `read`/`edit`/`write` toquen binarios (PDF, DOCX…).
 */
export function safetyExtension(pi: ExtensionAPI): void {
  /** Rutas (o directorios padre) de escritura aprobadas para la sesión. */
  const approvedPaths = new Set<string>();
  /** Etiquetas de patrón de bash aprobadas para la sesión. */
  const approvedBashLabels = new Set<string>();

  pi.on("session_start", async () => {
    approvedPaths.clear();
    approvedBashLabels.clear();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const cmd = String((event.input as { command?: string }).command ?? "");
      const hit = DESTRUCTIVE_BASH.find((d) => d.re.test(cmd));
      if (!hit) return undefined;
      if (approvedBashLabels.has(hit.label)) return undefined;
      if (!ctx.hasUI)
        return { block: true, reason: `Comando bloqueado sin confirmación interactiva: ${hit.label}` };
      const answer = await askPermission(ctx, `Comando potencialmente destructivo: ${hit.label}`, `$ ${cmd}`);
      if (answer === "session") approvedBashLabels.add(hit.label);
      return answer === "deny" ? { block: true, reason: `El usuario no autorizó: ${hit.label}` } : undefined;
    }

    if (event.toolName === "read") {
      const p = resolve(ctx.cwd, String((event.input as { path?: string }).path ?? ""));
      if (OFFICE_EXT.has(extname(p).toLowerCase())) {
        const tool = extname(p).toLowerCase() === ".pdf" ? "read_pdf" : "read_docx";
        return { block: true, reason: `Fichero binario: usa la herramienta ${tool} para leer ${p}` };
      }
      return undefined;
    }

    if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "write_docx") {
      const p = resolve(ctx.cwd, String((event.input as { path?: string }).path ?? ""));
      if (event.toolName !== "write_docx" && isBinaryFile(p)) {
        return {
          block: true,
          reason: `Fichero binario (${extname(p)}): no se puede editar como texto. Usa write_docx para generar un Word o deja el original intacto.`,
        };
      }
      const outside = !allowedRoots(ctx).some((root) => insideDir(p, root));
      if (!outside || approvedPaths.has(p) || approvedPaths.has(dirname(p))) return undefined;
      if (!ctx.hasUI)
        return { block: true, reason: `Escritura fuera del directorio de trabajo bloqueada: ${p}` };
      const answer = await askPermission(ctx, "Escritura fuera del expediente", `${event.toolName} → ${p}`);
      if (answer === "session") {
        // Recordar la ruta y su directorio: nuevas escrituras en la misma carpeta no vuelven a preguntar.
        approvedPaths.add(p);
        approvedPaths.add(dirname(p));
      }
      return answer === "deny"
        ? { block: true, reason: `El usuario no autorizó escribir en ${p}` }
        : undefined;
    }
    return undefined;
  });
}
