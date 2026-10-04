/**
 * Guardarraíl puro aplicado a cada bloque de texto del asistente:
 *   1. las URLs obtenidas con `web_fetch` cuentan como servidas,
 *   2. `sanitizeCitations` elimina enlaces/Roj/ECLI no servidos,
 *   3. `normalizeTribunalNames` solo fuera de blockquotes (citas literales) y
 *      fuera de las etiquetas de enlace (que reproducen el título servido),
 *   4. se devuelve la lista de lo eliminado.
 */

import { diffCitations, type StrippedCitation } from "./diff.js";
import { isAllowedEmpty } from "./harvest.js";
import { hasOldTribunalNames, normalizeTribunalNames } from "./normalize-tribunal-names.js";
import { ECLI_RE, ROJ_RE } from "./patterns.js";
import { type AllowedCitations, sanitizeCitations } from "./sanitize-citations.js";

export interface GuardResult {
  text: string;
  stripped: StrippedCitation[];
}

const BLOCKQUOTE_LINE_RE = /^\s*>/;
// Enlace completo `[label](url)`: se protege entero (etiqueta y URL).
const FULL_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

/** Normaliza nombres de tribunales respetando blockquotes y etiquetas de enlace. */
export function normalizeOutsideProtected(text: string): string {
  if (!hasOldTribunalNames(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (BLOCKQUOTE_LINE_RE.test(line)) return line;
      let out = "";
      let last = 0;
      for (const m of line.matchAll(FULL_LINK_RE)) {
        out += normalizeTribunalNames(line.slice(last, m.index));
        out += m[0];
        last = m.index + m[0].length;
      }
      out += normalizeTribunalNames(line.slice(last));
      return out;
    })
    .join("\n");
}

function hasCitationShapes(text: string): boolean {
  return (
    text.includes("](http") || new RegExp(ROJ_RE.source).test(text) || new RegExp(ECLI_RE.source).test(text)
  );
}

export function applyGuard(text: string, allowed: AllowedCitations, webUrls: Set<string>): GuardResult {
  // Vía rápida: sin nada servido y sin formas de cita en el texto no hay nada
  // que verificar; solo queda la normalización terminológica, que a su vez
  // sale en O(n) cuando no hay nombres antiguos.
  if (isAllowedEmpty(allowed) && webUrls.size === 0 && !hasCitationShapes(text)) {
    return { text: normalizeOutsideProtected(text), stripped: [] };
  }

  const effective: AllowedCitations =
    webUrls.size > 0 ? { ...allowed, urls: new Set([...allowed.urls, ...webUrls]) } : allowed;

  const sanitized = sanitizeCitations(text, effective);
  const stripped = diffCitations(text, sanitized);
  return { text: normalizeOutsideProtected(sanitized), stripped };
}
