import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export interface ExpedienteInfo {
  dir: string;
  name: string;
  instructions?: string;
  files: Array<{ name: string; size: number; kind: "dir" | "pdf" | "docx" | "text" | "image" | "other" }>;
  truncated: boolean;
}

const MAX_ENTRIES = 60;

function kindOf(name: string, isDir: boolean): ExpedienteInfo["files"][number]["kind"] {
  if (isDir) return "dir";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["docx", "doc", "odt"].includes(ext)) return "docx";
  if (["md", "txt", "csv", "json", "html", "eml"].includes(ext)) return "text";
  if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff"].includes(ext)) return "image";
  return "other";
}

export function readExpediente(dir: string): ExpedienteInfo {
  const instructionsPath = join(dir, "EXPEDIENTE.md");
  const instructions = existsSync(instructionsPath) ? readFileSync(instructionsPath, "utf8") : undefined;
  const entries = readdirSync(dir)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .sort((a, b) => a.localeCompare(b, "es"));
  const files = entries.slice(0, MAX_ENTRIES).map((name) => {
    const st = statSync(join(dir, name));
    return { name, size: st.size, kind: kindOf(name, st.isDirectory()) };
  });
  const title = instructions?.match(/^#\s+(?:Expediente:\s*)?(.+)$/m)?.[1]?.trim();
  return {
    dir,
    name: title && !title.startsWith("[") ? title : basename(dir),
    instructions,
    files,
    truncated: entries.length > MAX_ENTRIES,
  };
}

function formatSize(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Sección <expediente> para el system prompt. */
export function buildExpedienteSection(info: ExpedienteInfo): string {
  const lines: string[] = [];
  lines.push(`Expediente activo: ${info.name}`);
  lines.push(`Directorio: ${info.dir}`);
  if (info.instructions) {
    lines.push("", "Instrucciones del expediente (EXPEDIENTE.md):", info.instructions.trim());
  } else {
    lines.push("", "No hay EXPEDIENTE.md; si el usuario lo desea, propón crearlo con /expediente init.");
  }
  lines.push("", "Documentos en el directorio (nivel superior):");
  for (const f of info.files) {
    const tool =
      f.kind === "pdf"
        ? "read_pdf"
        : f.kind === "docx"
          ? "read_docx"
          : f.kind === "dir"
            ? "ls"
            : f.kind === "text" || f.kind === "image"
              ? "read"
              : "bash";
    lines.push(`- ${f.name}${f.kind === "dir" ? "/" : ` (${formatSize(f.size)})`} → ${tool}`);
  }
  if (info.truncated) lines.push(`- … (hay más de ${MAX_ENTRIES} entradas; usa ls/find para el resto)`);
  lines.push("", "Cita los documentos del expediente en **negrita** por su nombre, nunca con enlaces.");
  return lines.join("\n");
}
