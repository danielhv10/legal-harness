/**
 * Resúmenes compactos (en español) de llamadas y resultados de herramientas.
 * Código puro, sin dependencias de la TUI, para poder testearlo.
 */

export interface TruncationInfo {
  truncated: boolean;
  totalLines?: number;
}

/** Plural castellano sencillo: `plural(1, "línea", "líneas")` → "1 línea". */
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Primera línea no vacía de un texto (recortada a `max` caracteres). */
export function firstLine(text: string, max = 100): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.split("\n").length;
}

/** read → "N líneas" (+ "(truncado)" si procede). */
export function summarizeRead(text: string, truncation?: TruncationInfo): string {
  const n = countLines(text);
  const base = plural(n, "línea", "líneas");
  if (truncation?.truncated) {
    return truncation.totalLines ? `${base} de ${truncation.totalLines} (truncado)` : `${base} (truncado)`;
  }
  return base;
}

/** bash → primera línea con salida + "… (N líneas)", o "sin salida". */
export function summarizeBash(text: string, truncation?: TruncationInfo): string {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "sin salida";
  const head = firstLine(text, 80);
  const suffix = lines.length > 1 ? ` … (${plural(lines.length, "línea", "líneas")})` : "";
  const trunc = truncation?.truncated ? " (truncado)" : "";
  return `${head}${suffix}${trunc}`;
}

export interface EditStats {
  added: number;
  removed: number;
}

/** Cuenta líneas añadidas/eliminadas en un diff (ignora cabeceras `+++`/`---` y `@@`). */
export function editStats(diff: string): EditStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** edit → "+A −R líneas". Usa el diff de presentación y, si está vacío, el parche unificado. */
export function summarizeEdit(diff: string | undefined, patch?: string): string {
  const source = diff && diff.trim().length > 0 ? diff : (patch ?? "");
  const { added, removed } = editStats(source);
  if (added === 0 && removed === 0) return "sin cambios";
  return `+${added} −${removed} líneas`;
}

/** write → "N líneas escritas". */
export function summarizeWrite(content: string): string {
  const n = countLines(content);
  return `${n} ${n === 1 ? "línea escrita" : "líneas escritas"}`;
}

/** grep/find/ls → "N resultados" (líneas no vacías de la salida). */
export function countResults(text: string, truncation?: TruncationInfo): string {
  const n = text.split("\n").filter((l) => l.trim().length > 0).length;
  const lowered = text.trim().toLowerCase();
  if (n === 0 || lowered.startsWith("no matches") || lowered.startsWith("no files")) return "sin resultados";
  const base = plural(n, "resultado", "resultados");
  return truncation?.truncated ? `${base} (truncado)` : base;
}

/** Mensaje de error compacto: "Error: <primera línea>" sin duplicar el prefijo. */
export function summarizeError(text: string): string {
  const line = firstLine(text, 120);
  if (!line) return "Error: error desconocido";
  const stripped = line.replace(/^error\s*:?\s*/i, "");
  return `Error: ${stripped || line}`;
}

export interface CallDescription {
  verb: string;
  /** Argumento principal (ruta, comando, patrón). */
  subject: string;
  /** Detalle secundario (rango de líneas, directorio…). */
  detail?: string;
}

/** Acorta una ruta: relativa al cwd si está dentro; `~` para el home. */
export function displayPath(path: string, cwd: string, home = process.env.HOME ?? ""): string {
  if (!path) return path;
  const norm = (p: string) => p.replace(/\/+$/, "");
  const c = norm(cwd);
  if (c && path.startsWith(`${c}/`)) return path.slice(c.length + 1);
  if (c && path === c) return ".";
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dirLabel(path: unknown, cwd: string): string {
  const raw = str(path);
  if (!raw || raw === ".") return "./";
  const shown = displayPath(raw, cwd);
  return shown.endsWith("/") ? shown : `${shown}/`;
}

/** Descripción en español de una llamada a herramienta integrada. */
export function describeCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
  cwd: string,
): CallDescription | undefined {
  const a = args ?? {};
  switch (toolName) {
    case "read": {
      const offset = typeof a.offset === "number" ? a.offset : undefined;
      const limit = typeof a.limit === "number" ? a.limit : undefined;
      let detail: string | undefined;
      if (offset !== undefined && limit !== undefined) detail = `(líneas ${offset}-${offset + limit - 1})`;
      else if (offset !== undefined) detail = `(desde la línea ${offset})`;
      else if (limit !== undefined) detail = `(líneas 1-${limit})`;
      return { verb: "Leer", subject: displayPath(str(a.path), cwd) || "…", detail };
    }
    case "bash": {
      const command = firstLine(str(a.command), 80) || "…";
      return { verb: "Ejecutar", subject: `\`${command}\`` };
    }
    case "edit":
      return { verb: "Editar", subject: displayPath(str(a.path), cwd) || "…" };
    case "write": {
      const content = str(a.content);
      const detail = content ? `(${plural(countLines(content), "línea", "líneas")})` : undefined;
      return { verb: "Escribir", subject: displayPath(str(a.path), cwd) || "…", detail };
    }
    case "grep": {
      const pattern = str(a.pattern) || "…";
      const glob = str(a.glob);
      return {
        verb: "Buscar",
        subject: `«${pattern}»`,
        detail: `en ${dirLabel(a.path, cwd)}${glob ? ` (${glob})` : ""}`,
      };
    }
    case "find": {
      const pattern = str(a.pattern) || "*";
      const path = str(a.path);
      return {
        verb: "Buscar ficheros",
        subject: pattern,
        detail: path && path !== "." ? `en ${dirLabel(path, cwd)}` : undefined,
      };
    }
    case "ls":
      return { verb: "Listar", subject: dirLabel(a.path, cwd) };
    default:
      return undefined;
  }
}
