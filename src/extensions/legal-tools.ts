import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readDocxAsMarkdown } from "../lib/docx-read.js";
import { markdownToDocxDetailed } from "../lib/docx-write.js";
import { DEFAULT_MAX_PAGES, extractPdfText, parsePageRange } from "../lib/pdf.js";
import { DEFAULT_MAX_CHARS, fetchAsMarkdown } from "../lib/web/fetch.js";
import {
  DEFAULT_LEGAL_DOMAINS,
  formatSearchHits,
  resolveSearchProvider,
  type SearchHit,
} from "../lib/web/search.js";

/** Límite de caracteres devueltos al modelo por llamada. */
export const MODEL_TEXT_LIMIT = 40_000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function resolvePath(cwd: string, p: string): string {
  const expanded = p.startsWith("~/") && process.env.HOME ? `${process.env.HOME}${p.slice(1)}` : p;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  const home = process.env.HOME;
  return home && abs.startsWith(home) ? `~${abs.slice(home.length)}` : abs;
}

function ensureFile(abs: string, kind: string): void {
  if (!existsSync(abs)) throw new Error(`No existe el archivo ${kind}: ${abs}`);
  if (!statSync(abs).isFile()) throw new Error(`La ruta no es un archivo: ${abs}`);
}

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Truncated {
  text: string;
  truncated: boolean;
  total: number;
}

function truncateForModel(text: string, hint: string, limit = MODEL_TEXT_LIMIT): Truncated {
  if (text.length <= limit) return { text, truncated: false, total: text.length };
  return {
    text: `${text.slice(0, limit)}\n\n[… truncado: se muestran ${limit} de ${text.length} caracteres. ${hint}]`,
    truncated: true,
    total: text.length,
  };
}

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function line(...parts: Array<string | undefined>): Text {
  return new Text(parts.filter(Boolean).join(" "), 0, 0);
}

function multi(lines: Array<string | undefined>): Text {
  return new Text(lines.filter((l): l is string => l !== undefined).join("\n"), 0, 0);
}

function errorText(theme: Theme, result: AgentToolResult<unknown>): Text {
  return new Text(
    theme.fg("error", truncateToWidth(resultText(result).split("\n")[0] ?? "Error", 200)),
    0,
    0,
  );
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const readPdfSchema = Type.Object({
  path: Type.String({ description: "Ruta del PDF (relativa al directorio de trabajo o absoluta)" }),
  pages: Type.Optional(
    Type.String({
      description: `Páginas a extraer, p. ej. "1-3,7" (1-indexadas). Si se omite, se extraen las primeras ${DEFAULT_MAX_PAGES} páginas.`,
    }),
  ),
});

const readDocxSchema = Type.Object({
  path: Type.String({
    description: "Ruta del documento .docx (relativa al directorio de trabajo o absoluta)",
  }),
  offset: Type.Optional(
    Type.Number({
      description:
        "Carácter desde el que empezar a devolver texto (0 por defecto); útil en documentos largos",
    }),
  ),
});

const writeDocxSchema = Type.Object({
  path: Type.String({ description: "Ruta de destino del .docx (se añade la extensión si falta)" }),
  markdown: Type.String({
    description:
      "Contenido en Markdown: encabezados (#), **negrita**, *cursiva*, listas, tablas, > citas y --- como salto de página",
  }),
  title: Type.Optional(Type.String({ description: "Título para los metadatos del documento" })),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Permite sobrescribir si el archivo ya existe (false por defecto)" }),
  ),
});

const webSearchSchema = Type.Object({
  query: Type.String({ description: "Consulta de búsqueda" }),
  max_results: Type.Optional(
    Type.Number({ description: "Número máximo de resultados (por defecto 8, máximo 20)" }),
  ),
  domains: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Limitar a estos dominios, p. ej. ["boe.es", "poderjudicial.es"]',
    }),
  ),
  recency_days: Type.Optional(
    Type.Number({ description: "Solo resultados publicados en los últimos N días" }),
  ),
  oficial: Type.Optional(
    Type.Boolean({
      description:
        "Restringir a fuentes oficiales (BOE, CGPJ, TC, EUR-Lex, AEAT, Seguridad Social, AEPD, CNMC)",
    }),
  ),
});

const webFetchSchema = Type.Object({
  url: Type.String({ description: "URL http(s) pública a descargar" }),
  max_chars: Type.Optional(
    Type.Number({ description: `Máximo de caracteres del contenido (por defecto ${DEFAULT_MAX_CHARS})` }),
  ),
});

// ---------------------------------------------------------------------------
// Detalles de resultado
// ---------------------------------------------------------------------------

interface ReadPdfDetails {
  path: string;
  totalPages: number;
  pages: number[];
  scanned: boolean;
  chars: number;
  truncated: boolean;
}

interface ReadDocxDetails {
  path: string;
  chars: number;
  offset: number;
  truncated: boolean;
  messages: string[];
}

interface WriteDocxDetails {
  path: string;
  paragraphs: number;
  bytes: number;
  overwritten: boolean;
}

interface WebSearchDetails {
  provider: string;
  fallback: boolean;
  warning?: string;
  query: string;
  domains?: string[];
  hits: SearchHit[];
  error?: string;
}

interface WebFetchDetails {
  url: string;
  title: string;
  kind: "html" | "pdf" | "text";
  bytes: number;
  chars: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Extensión
// ---------------------------------------------------------------------------

export function legalToolsExtension(pi: ExtensionAPI): void {
  // --- read_pdf -----------------------------------------------------------
  pi.registerTool<typeof readPdfSchema, ReadPdfDetails>({
    name: "read_pdf",
    label: "Leer PDF",
    description:
      "Extrae el texto de un PDF local, página a página (cada página va precedida de '--- Página N ---'). Usa `pages` para acotar en documentos largos. Si el PDF es un escaneo sin capa de texto, lo indica (no hace OCR).",
    promptSnippet: "read_pdf: extrae el texto de un PDF local por páginas",
    parameters: readPdfSchema,
    exposure: "direct",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const abs = resolvePath(ctx.cwd, params.path);
      ensureFile(abs, "PDF");
      let pages: number[] | undefined;
      if (params.pages?.trim()) pages = parsePageRange(params.pages);
      const result = await extractPdfText(abs, { pages, signal });
      const shown = displayPath(ctx.cwd, abs);
      let text: string;
      if (result.scanned) {
        text = `El PDF ${shown} (${pluralize(result.totalPages, "página", "páginas")}) no contiene capa de texto en las páginas seleccionadas: probablemente es un documento escaneado. Hace falta OCR, que no está disponible en esta versión.`;
      } else {
        const header = `Documento: ${shown} · ${pluralize(result.totalPages, "página", "páginas")} · extraídas: ${describePages(result.pages, result.totalPages)}\n\n`;
        const t = truncateForModel(
          result.text,
          'Usa el parámetro `pages` (p. ej. "5-10") para leer el resto.',
        );
        text = header + t.text;
        if (result.totalPages > result.pages.length && !pages) {
          text += `\n\n[Solo se han extraído las primeras ${result.pages.length} páginas de ${result.totalPages}. Usa \`pages\` para leer las siguientes.]`;
        }
        return textResult(text, {
          path: abs,
          totalPages: result.totalPages,
          pages: result.pages,
          scanned: false,
          chars: result.text.length,
          truncated: t.truncated,
        });
      }
      return textResult(text, {
        path: abs,
        totalPages: result.totalPages,
        pages: result.pages,
        scanned: true,
        chars: 0,
        truncated: false,
      });
    },
    renderCall(args, theme) {
      const pages = args.pages ? theme.fg("muted", ` páginas ${args.pages}`) : "";
      return line(theme.fg("toolTitle", theme.bold("read_pdf")), theme.fg("accent", args.path ?? ""), pages);
    },
    renderResult(result, options, theme) {
      if (result.isError) return errorText(theme, result);
      const d = result.details;
      if (!d) return line(theme.fg("muted", "(sin detalles)"));
      if (d.scanned)
        return line(
          theme.fg("warning", `PDF escaneado sin texto (${pluralize(d.totalPages, "página", "páginas")})`),
        );
      const summary = `${pluralize(d.pages.length, "página", "páginas")} de ${d.totalPages} · ${formatKb(d.chars)} de texto${d.truncated ? theme.fg("warning", " · truncado") : ""}`;
      if (!options.expanded) return line(theme.fg("success", "✓"), summary);
      const preview = resultText(result)
        .split("\n")
        .slice(0, 25)
        .map((l) => truncateToWidth(l, 160));
      return multi([
        `${theme.fg("success", "✓")} ${summary}`,
        theme.fg("dim", `Páginas: ${describePages(d.pages, d.totalPages)}`),
        "",
        ...preview.map((l) => theme.fg("toolOutput", l)),
      ]);
    },
  });

  // --- read_docx ----------------------------------------------------------
  pi.registerTool<typeof readDocxSchema, ReadDocxDetails>({
    name: "read_docx",
    label: "Leer Word",
    description:
      "Lee un documento Word (.docx) local y lo devuelve como Markdown (encabezados, listas, tablas, negritas). Para documentos muy largos usa `offset` para continuar desde un punto.",
    promptSnippet: "read_docx: lee un .docx local y lo devuelve en Markdown",
    parameters: readDocxSchema,
    exposure: "direct",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const abs = resolvePath(ctx.cwd, params.path);
      ensureFile(abs, ".docx");
      const ext = extname(abs).toLowerCase();
      if (ext === ".doc")
        throw new Error("Los archivos .doc (Word 97-2003) no están soportados; conviértelo a .docx primero.");
      const { markdown, messages } = await readDocxAsMarkdown(abs);
      const offset = Math.max(0, Math.floor(params.offset ?? 0));
      if (offset >= markdown.length && markdown.length > 0) {
        throw new Error(
          `El offset ${offset} supera la longitud del documento (${markdown.length} caracteres).`,
        );
      }
      const slice = markdown.slice(offset);
      const t = truncateForModel(
        slice,
        `Llama de nuevo con offset=${offset + MODEL_TEXT_LIMIT} para continuar.`,
      );
      const header = `Documento: ${displayPath(ctx.cwd, abs)} · ${formatKb(markdown.length)} de texto${offset ? ` · desde el carácter ${offset}` : ""}\n\n`;
      const text = header + (slice.trim() ? t.text : "(documento sin texto)");
      return textResult(text, {
        path: abs,
        chars: markdown.length,
        offset,
        truncated: t.truncated,
        messages,
      });
    },
    renderCall(args, theme) {
      const off = args.offset ? theme.fg("muted", ` desde ${args.offset}`) : "";
      return line(theme.fg("toolTitle", theme.bold("read_docx")), theme.fg("accent", args.path ?? ""), off);
    },
    renderResult(result, options, theme) {
      if (result.isError) return errorText(theme, result);
      const d = result.details;
      if (!d) return line(theme.fg("muted", "(sin detalles)"));
      const summary = `${formatKb(d.chars)} de texto${d.truncated ? theme.fg("warning", " · truncado") : ""}${d.messages.length ? theme.fg("dim", ` · ${pluralize(d.messages.length, "aviso", "avisos")}`) : ""}`;
      if (!options.expanded) return line(theme.fg("success", "✓"), summary);
      const preview = resultText(result)
        .split("\n")
        .slice(0, 25)
        .map((l) => truncateToWidth(l, 160));
      return multi([
        `${theme.fg("success", "✓")} ${summary}`,
        ...d.messages.slice(0, 5).map((m) => theme.fg("dim", `· ${m}`)),
        "",
        ...preview.map((l) => theme.fg("toolOutput", l)),
      ]);
    },
  });

  // --- write_docx ---------------------------------------------------------
  pi.registerTool<typeof writeDocxSchema, WriteDocxDetails>({
    name: "write_docx",
    label: "Guardar Word",
    description:
      "Genera un documento Word (.docx) a partir de Markdown con formato jurídico por defecto (Times New Roman 12, justificado, A4, márgenes 2,5 cm). Soporta encabezados, negrita/cursiva, listas, tablas, citas y '---' como salto de página. No sobrescribe archivos existentes salvo overwrite=true.",
    promptSnippet: "write_docx: crea un .docx a partir de Markdown",
    parameters: writeDocxSchema,
    exposure: "direct",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let abs = resolvePath(ctx.cwd, params.path);
      if (extname(abs).toLowerCase() !== ".docx") abs = `${abs}.docx`;
      const exists = existsSync(abs);
      if (exists && !params.overwrite) {
        throw new Error(
          `Ya existe ${displayPath(ctx.cwd, abs)}. Si quieres reemplazarlo, repite la llamada con overwrite: true o usa otro nombre.`,
        );
      }
      if (exists && !statSync(abs).isFile()) throw new Error(`La ruta ${abs} existe y no es un archivo.`);
      if (!params.markdown.trim()) throw new Error("El contenido Markdown está vacío.");
      const { buffer, paragraphs } = await markdownToDocxDetailed(params.markdown, { title: params.title });
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buffer);
      const kb = Math.max(1, Math.round(buffer.length / 1024));
      return textResult(
        `Documento guardado en ${abs} (${pluralize(paragraphs, "párrafo", "párrafos")}, ${kb} KB)`,
        { path: abs, paragraphs, bytes: buffer.length, overwritten: exists },
      );
    },
    renderCall(args, theme) {
      const extra = [
        args.title ? theme.fg("muted", `«${args.title}»`) : undefined,
        args.overwrite ? theme.fg("warning", "(sobrescribir)") : undefined,
      ];
      return line(
        theme.fg("toolTitle", theme.bold("write_docx")),
        theme.fg("accent", args.path ?? ""),
        ...extra,
      );
    },
    renderResult(result, options, theme) {
      if (result.isError) return errorText(theme, result);
      const d = result.details;
      if (!d) return line(theme.fg("muted", "(sin detalles)"));
      const summary = `${pluralize(d.paragraphs, "párrafo", "párrafos")} · ${formatKb(d.bytes)}${d.overwritten ? theme.fg("warning", " · sobrescrito") : ""}`;
      if (!options.expanded) return line(theme.fg("success", "✓ guardado"), summary);
      return multi([`${theme.fg("success", "✓ guardado")} ${summary}`, theme.fg("dim", d.path)]);
    },
  });

  // --- web_search ---------------------------------------------------------
  pi.registerTool<typeof webSearchSchema, WebSearchDetails>({
    name: "web_search",
    label: "Buscar en la web",
    description:
      "Busca en la web y devuelve título, URL y resumen de cada resultado. Úsala solo cuando las fuentes jurídicas del servidor MCP no cubran la consulta. Con `oficial: true` se limita a dominios oficiales (BOE, CGPJ, TC, EUR-Lex, AEAT, Seguridad Social, AEPD, CNMC). Para leer un resultado usa web_fetch con su URL; cita únicamente lo que hayas leído.",
    promptSnippet: "web_search: busca en la web (título, URL, resumen)",
    parameters: webSearchSchema,
    exposure: "direct",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async execute(_id, params, signal) {
      const resolved = resolveSearchProvider(process.env);
      const maxResults = Math.min(Math.max(Math.floor(params.max_results ?? 8), 1), 20);
      const domains = [...(params.oficial ? DEFAULT_LEGAL_DOMAINS : []), ...(params.domains ?? [])];
      const query = params.query.trim();
      if (!query) throw new Error("La consulta de búsqueda está vacía.");
      const base: Omit<WebSearchDetails, "hits"> = {
        provider: resolved.provider.name,
        fallback: resolved.fallback,
        warning: resolved.warning,
        query,
        domains: domains.length ? domains : undefined,
      };
      let hits: SearchHit[];
      try {
        hits = await resolved.provider.search(
          query,
          { maxResults, domains: domains.length ? domains : undefined, recencyDays: params.recency_days },
          signal,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`La búsqueda web ha fallado (${resolved.provider.name}): ${msg}`, {
          ...base,
          hits: [],
          error: msg,
        });
      }
      const notes: string[] = [];
      if (resolved.warning) notes.push(resolved.warning);
      if (resolved.fallback)
        notes.push(
          "Proveedor: DuckDuckGo (sin API key configurada; define TAVILY_API_KEY, BRAVE_API_KEY o EXA_API_KEY para mejores resultados).",
        );
      else notes.push(`Proveedor: ${resolved.provider.name}.`);
      if (domains.length) notes.push(`Dominios: ${domains.join(", ")}.`);
      const text = `${notes.join(" ")}\n\n${formatSearchHits(hits)}\n\nPara leer un resultado usa web_fetch con su URL. No cites URLs que no hayas leído.`;
      return textResult(text, { ...base, hits });
    },
    renderCall(args, theme) {
      const extra = [
        args.oficial ? theme.fg("muted", "[oficial]") : undefined,
        args.domains?.length ? theme.fg("muted", `[${args.domains.join(", ")}]`) : undefined,
      ];
      return line(
        theme.fg("toolTitle", theme.bold("web_search")),
        theme.fg("accent", `"${truncateToWidth(args.query ?? "", 80)}"`),
        ...extra,
      );
    },
    renderResult(result, options, theme) {
      if (result.isError) return errorText(theme, result);
      const d = result.details;
      if (!d) return line(theme.fg("muted", "(sin detalles)"));
      if (d.error) return line(theme.fg("error", `✗ ${d.provider}: ${truncateToWidth(d.error, 120)}`));
      const summary = `${pluralize(d.hits.length, "resultado", "resultados")} ${theme.fg("dim", `(${d.provider}${d.fallback ? ", sin API key" : ""})`)}`;
      if (!options.expanded) return line(theme.fg("success", "✓"), summary);
      const rows = d.hits.flatMap((h, i) => [
        `${theme.fg("dim", `${i + 1}.`)} ${truncateToWidth(h.title, 100)}`,
        `   ${theme.fg("mdLinkUrl", truncateToWidth(h.url, 110))}`,
      ]);
      return multi([
        `${theme.fg("success", "✓")} ${summary}`,
        d.warning ? theme.fg("warning", d.warning) : undefined,
        ...rows,
      ]);
    },
  });

  // --- web_fetch ----------------------------------------------------------
  pi.registerTool<typeof webFetchSchema, WebFetchDetails>({
    name: "web_fetch",
    label: "Leer página web",
    description:
      "Descarga una URL pública y devuelve su contenido en Markdown (HTML con extracción del artículo principal, PDF con texto por páginas, o texto plano). Empieza con 'Fuente:' y 'Título:'. Solo acepta http(s) y bloquea direcciones locales/privadas.",
    promptSnippet: "web_fetch: descarga una URL y la devuelve en Markdown",
    parameters: webFetchSchema,
    exposure: "direct",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async execute(_id, params, signal) {
      const maxChars = Math.min(
        Math.max(Math.floor(params.max_chars ?? DEFAULT_MAX_CHARS), 500),
        MODEL_TEXT_LIMIT * 2,
      );
      const r = await fetchAsMarkdown(params.url.trim(), { maxChars, signal });
      const t = truncateForModel(r.markdown, "Reduce max_chars o pide secciones concretas.");
      return textResult(t.text, {
        url: r.url,
        title: r.title,
        kind: r.kind,
        bytes: r.bytes,
        chars: r.markdown.length,
        truncated: r.truncated || t.truncated,
      });
    },
    renderCall(args, theme) {
      return line(
        theme.fg("toolTitle", theme.bold("web_fetch")),
        theme.fg("mdLinkUrl", truncateToWidth(args.url ?? "", 120)),
      );
    },
    renderResult(result, options, theme) {
      if (result.isError) return errorText(theme, result);
      const d = result.details;
      if (!d) return line(theme.fg("muted", "(sin detalles)"));
      const summary = `${truncateToWidth(d.title, 80)} ${theme.fg("dim", `· ${d.kind} · ${formatKb(d.bytes)}${d.truncated ? " · truncado" : ""}`)}`;
      if (!options.expanded) return line(theme.fg("success", "✓"), summary);
      const preview = resultText(result)
        .split("\n")
        .slice(0, 20)
        .map((l) => truncateToWidth(l, 160));
      return multi([
        `${theme.fg("success", "✓")} ${summary}`,
        theme.fg("mdLinkUrl", d.url),
        "",
        ...preview.map((l) => theme.fg("toolOutput", l)),
      ]);
    },
  });

  // --- Renderer para herramientas MCP (mcp__<servidor>__<tool>) -----------
  pi.registerToolRenderer((toolName, next) => {
    if (!toolName.startsWith("mcp__")) return next();
    const base: ToolRenderers | undefined = (() => {
      try {
        return next();
      } catch {
        return undefined;
      }
    })();
    const shortName = toolName.split("__").pop() || toolName;
    return {
      renderShell: base?.renderShell,
      renderCall(args: unknown, theme: Theme, context) {
        try {
          const subject = mcpSubject(args);
          return line(
            theme.fg("toolTitle", theme.bold(shortName)),
            subject ? theme.fg("accent", `"${truncateToWidth(subject, 90)}"`) : undefined,
          );
        } catch {
          if (base?.renderCall) return base.renderCall(args, theme, context);
          return line(theme.fg("toolTitle", theme.bold(shortName)));
        }
      },
      renderResult(result: AgentToolResult<unknown>, options, theme: Theme, context) {
        try {
          if (options.expanded && base?.renderResult)
            return base.renderResult(result, options, theme, context);
          if (result.isError) return errorText(theme, result);
          const text = resultText(result);
          const links = (text.match(/^Enlace:/gm) ?? []).length;
          if (links > 0) {
            const summary = pluralize(links, "documento", "documentos");
            if (!options.expanded)
              return line(theme.fg("success", "✓"), summary, theme.fg("dim", `· ${formatKb(text.length)}`));
            const titles = text
              .split("\n")
              .filter((l) => /^(Título|Titulo|Title):/i.test(l))
              .slice(0, 12)
              .map((l) => theme.fg("dim", `· ${truncateToWidth(l.replace(/^[^:]+:\s*/, ""), 120)}`));
            return multi([`${theme.fg("success", "✓")} ${summary}`, ...titles]);
          }
          const first = text.split("\n").find((l) => l.trim()) ?? "(sin contenido)";
          if (!options.expanded) return line(theme.fg("success", "✓"), truncateToWidth(first, 140));
          const preview = text
            .split("\n")
            .slice(0, 20)
            .map((l) => truncateToWidth(l, 160));
          return multi(preview.map((l) => theme.fg("toolOutput", l)));
        } catch {
          if (base?.renderResult) return base.renderResult(result, options, theme, context);
          return line(theme.fg("muted", "(resultado)"));
        }
      },
    };
  });
}

function describePages(pages: number[], total: number): string {
  if (pages.length === 0) return "ninguna";
  if (pages.length === total) return "todas";
  // Compactar en rangos: [1,2,3,7] → "1-3, 7"
  const parts: string[] = [];
  let start = pages[0] as number;
  let prev = start;
  for (let i = 1; i <= pages.length; i++) {
    const p = pages[i];
    if (p !== undefined && p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (p !== undefined) {
      start = p;
      prev = p;
    }
  }
  return parts.join(", ");
}

function mcpSubject(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const key of ["query", "doc_key", "docKey", "q", "question", "consulta", "id", "url", "path"]) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const firstString = Object.values(a).find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return firstString?.trim();
}
