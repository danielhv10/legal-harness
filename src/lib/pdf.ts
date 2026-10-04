import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfExtractOptions {
  /** Páginas concretas (1-indexadas). Si se omite, todas hasta `maxPages`. */
  pages?: number[];
  signal?: AbortSignal;
  /** Límite de páginas a extraer cuando no se indica `pages`. Por defecto 60. */
  maxPages?: number;
}

export interface PdfExtractResult {
  /** Texto con cada página prefijada por `--- Página N ---`. */
  text: string;
  totalPages: number;
  /** Páginas realmente extraídas (1-indexadas). */
  pages: number[];
  /** true si ninguna de las páginas seleccionadas tiene capa de texto (PDF escaneado). */
  scanned: boolean;
}

export const DEFAULT_MAX_PAGES = 60;

/**
 * Interpreta un rango como "1-3,7,10-12" → [1,2,3,7,10,11,12].
 * Ignora espacios; lanza con mensaje en español si el formato no es válido.
 */
export function parsePageRange(spec: string, totalPages?: number): number[] {
  const out = new Set<number>();
  const parts = spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error(`Rango de páginas vacío: "${spec}"`);
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Rango de páginas no válido: "${part}" (usa por ejemplo "1-3,7")`);
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b < 1) throw new Error(`Las páginas empiezan en 1: "${part}"`);
    if (b < a) throw new Error(`Rango invertido: "${part}"`);
    const hi = totalPages !== undefined ? Math.min(b, totalPages) : b;
    for (let i = a; i <= hi; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Lectura del PDF cancelada");
}

/**
 * Extrae el texto de un PDF (ruta o bytes) con unpdf/pdf.js.
 * Las páginas se devuelven prefijadas con `--- Página N ---`.
 */
export async function extractPdfText(
  input: string | Uint8Array,
  opts: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  throwIfAborted(opts.signal);
  const data = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
  throwIfAborted(opts.signal);

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo abrir el PDF: ${msg}`);
  }

  try {
    const totalPages = pdf.numPages;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    let selected: number[];
    if (opts.pages && opts.pages.length > 0) {
      selected = [...new Set(opts.pages)]
        .filter((p) => Number.isInteger(p) && p >= 1 && p <= totalPages)
        .sort((a, b) => a - b);
      if (selected.length === 0) {
        throw new Error(
          `Ninguna de las páginas solicitadas existe (el documento tiene ${totalPages} página${totalPages === 1 ? "" : "s"})`,
        );
      }
    } else {
      const n = Math.min(totalPages, maxPages);
      selected = Array.from({ length: n }, (_, i) => i + 1);
    }

    const { text: perPage } = await extractText(pdf, { mergePages: false });
    throwIfAborted(opts.signal);

    const chunks: string[] = [];
    let anyText = false;
    for (const p of selected) {
      const raw = (perPage[p - 1] ?? "").replace(/\s+\n/g, "\n").trim();
      if (raw.length > 0) anyText = true;
      chunks.push(`--- Página ${p} ---\n${raw}`);
    }

    return {
      text: chunks.join("\n\n"),
      totalPages,
      pages: selected,
      scanned: !anyText,
    };
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // ignorar
    }
  }
}
