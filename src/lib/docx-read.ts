import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { NodeHtmlMarkdown } from "node-html-markdown";

export interface DocxReadResult {
  markdown: string;
  /** Avisos de mammoth (estilos no reconocidos, imágenes omitidas, etc.). */
  messages: string[];
}

const nhm = new NodeHtmlMarkdown({
  useInlineLinks: true,
  codeBlockStyle: "fenced",
  bulletMarker: "-",
  maxConsecutiveNewlines: 2,
});

/** Convierte HTML a Markdown (encabezados ATX, tablas GFM). */
export function htmlToMarkdown(html: string): string {
  return nhm.translate(html).trim();
}

/**
 * Lee un .docx y lo devuelve como Markdown vía mammoth (DOCX→HTML) + node-html-markdown.
 * Acepta ruta o bytes.
 */
export async function readDocxAsMarkdown(input: string | Buffer | Uint8Array): Promise<DocxReadResult> {
  const buffer =
    typeof input === "string" ? await readFile(input) : Buffer.isBuffer(input) ? input : Buffer.from(input);
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
        ],
        ignoreEmptyParagraphs: true,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo leer el documento Word: ${msg}`);
  }
  const markdown = htmlToMarkdown(result.value);
  const messages = result.messages.map((m) => `${m.type}: ${m.message}`);
  return { markdown, messages };
}
