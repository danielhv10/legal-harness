/**
 * Realce visual (solo renderizado, no altera el transcript) del Markdown jurídico:
 * - "Roj: X" y "ECLI: Y" → etiqueta en negrita e identificador en código (color de acento).
 * - DEROGADO / DEROGADA / NO VIGENTE → negrita.
 * - "modificado el AAAA-MM-DD" → negrita.
 * No toca bloques de código, código inline ni las URL de los enlaces.
 */

const ROJ_ID = String.raw`[A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?`;
const ECLI_ID = String.raw`ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?`;

const ROJ_RE = new RegExp(String.raw`(?<![*\`\w])(Roj):\s*(${ROJ_ID})(?![\w*\`])`, "g");
const ECLI_RE = new RegExp(String.raw`(?<![*\`\w])(ECLI):\s*(${ECLI_ID})(?![\w*\`])`, "g");
const DEROGADO_RE = /(?<![*\w])(DEROGAD[OA]S?|NO VIGENTE|SUPRIMID[OA]S?)(?![*\w])/g;
const MODIFICADO_RE = /(?<![*\w])(modificad[oa] el \d{4}-\d{2}-\d{2})(?![*\w])/g;

function highlightSegment(text: string): string {
  return text
    .replace(ROJ_RE, "**$1:** `$2`")
    .replace(ECLI_RE, "**$1:** `$2`")
    .replace(DEROGADO_RE, "**$1**")
    .replace(MODIFICADO_RE, "**$1**");
}

/** Divide una línea en tramos protegidos (código inline, destino de enlace) y tramos editables. */
function highlightLine(line: string): string {
  // Tramos protegidos: `código` y (url) tras ']' en enlaces Markdown.
  const protectedRe = /(`[^`]*`)|(\]\([^)\s]*\))/g;
  let out = "";
  let last = 0;
  for (const m of line.matchAll(protectedRe)) {
    const idx = m.index ?? 0;
    out += highlightSegment(line.slice(last, idx));
    out += m[0];
    last = idx + m[0].length;
  }
  out += highlightSegment(line.slice(last));
  return out;
}

export function highlightLegalMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    lines[i] = highlightLine(line);
  }
  return lines.join("\n");
}
