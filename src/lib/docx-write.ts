import {
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

export interface MarkdownToDocxOptions {
  /** Título para los metadatos del documento. */
  title?: string;
  /** Autor para los metadatos. */
  creator?: string;
}

export interface MarkdownToDocxResult {
  buffer: Buffer;
  /** Número de párrafos/bloques generados (para el mensaje de resultado). */
  paragraphs: number;
}

const FONT = "Times New Roman";
const SIZE_HALF_POINTS = 24; // 12 pt
const BULLETS_REF = "letrado-bullets";
const NUMBERS_REF = "letrado-numbers";
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

type Block = Paragraph | Table;

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
  strike?: boolean;
}

type InlineChild = TextRun | ExternalHyperlink;

function run(text: string, style: InlineStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? "Courier New" : undefined,
  });
}

function inlineRuns(tokens: Token[] | undefined, style: InlineStyle = {}): InlineChild[] {
  const out: InlineChild[] = [];
  if (!tokens) return out;
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens && tt.tokens.length > 0) out.push(...inlineRuns(tt.tokens, style));
        else out.push(run(decodeEntities(tt.text), style));
        break;
      }
      case "escape":
        out.push(run((t as Tokens.Escape).text, style));
        break;
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...inlineRuns((t as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(run(decodeEntities((t as Tokens.Codespan).text), { ...style, code: true }));
        break;
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        const link = t as Tokens.Link;
        const children = inlineRuns(link.tokens, style).filter((c): c is TextRun => c instanceof TextRun);
        out.push(
          new ExternalHyperlink({
            link: link.href,
            children: children.length > 0 ? children : [run(link.href, style)],
          }),
        );
        break;
      }
      case "image":
        out.push(
          run(`[Imagen: ${(t as Tokens.Image).text || (t as Tokens.Image).href}]`, {
            ...style,
            italics: true,
          }),
        );
        break;
      case "html":
        out.push(run(stripTags((t as Tokens.HTML).text), style));
        break;
      default: {
        const generic = t as Tokens.Generic;
        if (generic.tokens) out.push(...inlineRuns(generic.tokens, style));
        else if (typeof generic.text === "string") out.push(run(generic.text, style));
        else if (typeof generic.raw === "string") out.push(run(generic.raw, style));
      }
    }
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

class Builder {
  readonly blocks: Block[] = [];
  private numberedInstance = 0;

  addBlocks(tokens: Token[]): void {
    for (const t of tokens) this.block(t);
  }

  private block(t: Token): void {
    switch (t.type) {
      case "space":
        return;
      case "heading": {
        const h = t as Tokens.Heading;
        const level = HEADINGS[Math.min(Math.max(h.depth, 1), 6) - 1];
        this.blocks.push(
          new Paragraph({
            heading: level,
            alignment: AlignmentType.LEFT,
            children: inlineRuns(h.tokens),
          }),
        );
        return;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        this.blocks.push(new Paragraph({ children: inlineRuns(p.tokens) }));
        return;
      }
      case "text": {
        // Texto suelto a nivel de bloque (dentro de list items "tight").
        const tt = t as Tokens.Text;
        this.blocks.push(new Paragraph({ children: inlineRuns(tt.tokens ?? [tt]) }));
        return;
      }
      case "list":
        this.list(t as Tokens.List, 0);
        return;
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        for (const inner of bq.tokens) {
          if (inner.type === "paragraph" || inner.type === "text") {
            const toks = (inner as Tokens.Paragraph).tokens ?? [inner];
            this.blocks.push(
              new Paragraph({
                indent: { left: convertMillimetersToTwip(12.5), right: convertMillimetersToTwip(12.5) },
                children: inlineRuns(toks, { italics: true }),
              }),
            );
          } else {
            this.block(inner);
          }
        }
        return;
      }
      case "code": {
        const c = t as Tokens.Code;
        for (const line of c.text.split("\n")) {
          this.blocks.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
              children: [new TextRun({ text: line, font: "Courier New", size: 20 })],
            }),
          );
        }
        this.blocks.push(new Paragraph({ children: [] }));
        return;
      }
      case "hr":
        this.blocks.push(new Paragraph({ children: [new PageBreak()] }));
        return;
      case "table":
        this.table(t as Tokens.Table);
        return;
      case "html": {
        const text = stripTags((t as Tokens.HTML).text);
        if (text) this.blocks.push(new Paragraph({ children: [new TextRun(text)] }));
        return;
      }
      case "def":
        return;
      default: {
        const g = t as Tokens.Generic;
        if (g.tokens) this.blocks.push(new Paragraph({ children: inlineRuns(g.tokens) }));
        else if (typeof g.raw === "string" && g.raw.trim())
          this.blocks.push(new Paragraph({ children: [new TextRun(g.raw.trim())] }));
      }
    }
  }

  private list(list: Tokens.List, level: number): void {
    const instance = list.ordered ? ++this.numberedInstance : undefined;
    const reference = list.ordered ? NUMBERS_REF : BULLETS_REF;
    for (const item of list.items) {
      let first = true;
      for (const inner of item.tokens) {
        if (inner.type === "list") {
          this.list(inner as Tokens.List, Math.min(level + 1, 8));
          continue;
        }
        if (inner.type === "space") continue;
        const toks: Token[] =
          inner.type === "paragraph" || inner.type === "text"
            ? ((inner as Tokens.Paragraph).tokens ?? [inner])
            : [inner];
        const children = inlineRuns(toks);
        if (item.task) children.unshift(new TextRun({ text: item.checked ? "☑ " : "☐ " }));
        if (first) {
          this.blocks.push(
            new Paragraph({
              numbering: { reference, level, instance },
              children,
            }),
          );
          first = false;
        } else {
          // Párrafos adicionales del mismo ítem: sangrados sin viñeta.
          this.blocks.push(
            new Paragraph({
              indent: { left: convertMillimetersToTwip(6.35 * (level + 1) + 6.35) },
              children,
            }),
          );
        }
      }
      if (first) {
        // Ítem vacío
        this.blocks.push(new Paragraph({ numbering: { reference, level, instance }, children: [] }));
      }
    }
  }

  private table(tbl: Tokens.Table): void {
    const cols = Math.max(tbl.header.length, ...tbl.rows.map((r) => r.length), 1);
    const pct = Math.floor(100 / cols);
    const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const mkRow = (cells: Tokens.TableCell[], header: boolean) =>
      new TableRow({
        tableHeader: header,
        children: Array.from({ length: cols }, (_, i) => {
          const cell = cells[i];
          const align =
            cell?.align === "center"
              ? AlignmentType.CENTER
              : cell?.align === "right"
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT;
          return new TableCell({
            borders,
            width: { size: pct, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: align,
                children: cell ? inlineRuns(cell.tokens, header ? { bold: true } : {}) : [],
              }),
            ],
          });
        }),
      });
    const rows = [mkRow(tbl.header, true), ...tbl.rows.map((r) => mkRow(r, false))];
    this.blocks.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    this.blocks.push(new Paragraph({ children: [] }));
  }
}

/**
 * Convierte Markdown en un .docx: Times New Roman 12 pt, justificado, A4, márgenes de 2,5 cm.
 * Soporta encabezados, negrita/cursiva/código, listas (viñetas y numeradas, anidadas),
 * tablas, citas (sangría en cursiva) y `---` como salto de página.
 */
export async function markdownToDocxDetailed(
  markdown: string,
  opts: MarkdownToDocxOptions = {},
): Promise<MarkdownToDocxResult> {
  const tokens = marked.lexer(markdown, { gfm: true });
  const builder = new Builder();
  builder.addBlocks(tokens);
  const children = builder.blocks.length > 0 ? builder.blocks : [new Paragraph({ children: [] })];

  const margin = convertMillimetersToTwip(25);
  const headingStyle = (size: number) => ({
    run: { font: FONT, size, bold: true, color: "000000" },
    paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.LEFT },
  });

  const doc = new Document({
    title: opts.title,
    creator: opts.creator ?? "letrado",
    description: opts.title,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_HALF_POINTS },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 276 } },
        },
        heading1: headingStyle(32),
        heading2: headingStyle(28),
        heading3: headingStyle(26),
        heading4: headingStyle(24),
        heading5: headingStyle(24),
        heading6: headingStyle(24),
        listParagraph: { run: { font: FONT, size: SIZE_HALF_POINTS } },
        hyperlink: { run: { color: "0563C1", underline: {} } },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS_REF,
          levels: ["•", "◦", "▪", "•", "◦", "▪", "•", "◦", "▪"].map((text, level) => ({
            level,
            format: LevelFormat.BULLET,
            text,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
        {
          reference: NUMBERS_REF,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format:
              level % 3 === 1
                ? LevelFormat.LOWER_LETTER
                : level % 3 === 2
                  ? LevelFormat.LOWER_ROMAN
                  : LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: { top: margin, right: margin, bottom: margin, left: margin },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, paragraphs: builder.blocks.length };
}

/** Variante simple: solo devuelve los bytes del .docx. */
export async function markdownToDocx(markdown: string, opts: MarkdownToDocxOptions = {}): Promise<Buffer> {
  return (await markdownToDocxDetailed(markdown, opts)).buffer;
}
