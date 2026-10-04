import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { state } from "../state.js";

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
  const approvedPaths = new Set<string>();

  pi.on("session_start", async () => {
    approvedPaths.clear();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const cmd = String((event.input as { command?: string }).command ?? "");
      const hit = DESTRUCTIVE_BASH.find((d) => d.re.test(cmd));
      if (!hit) return undefined;
      if (!ctx.hasUI)
        return { block: true, reason: `Comando bloqueado sin confirmación interactiva: ${hit.label}` };
      const ok = await ctx.ui.confirm(
        "Comando potencialmente destructivo",
        `${hit.label}\n\n${cmd}\n\n¿Ejecutar?`,
      );
      return ok ? undefined : { block: true, reason: `El usuario no autorizó: ${hit.label}` };
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
      if (!outside || approvedPaths.has(p)) return undefined;
      if (!ctx.hasUI)
        return { block: true, reason: `Escritura fuera del directorio de trabajo bloqueada: ${p}` };
      const ok = await ctx.ui.confirm(
        "Escritura fuera del expediente",
        `${event.toolName} → ${p}\n\n¿Permitir?`,
      );
      if (ok) approvedPaths.add(p);
      return ok ? undefined : { block: true, reason: `El usuario no autorizó escribir en ${p}` };
    }
    return undefined;
  });
}
