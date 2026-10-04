/**
 * Patrones compartidos por harvest/diff/guard. Son copias literales de las
 * expresiones privadas de `sanitize-citations.ts` (port verbatim, no exporta
 * sus constantes) para que los tres módulos reconozcan exactamente las mismas
 * formas de enlace, Roj y ECLI.
 */

/** Enlace Markdown `[label](url)` con URL http(s) sin espacios ni `)`. */
export const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** ECLI: `ES:TS:2025:5286`, `ES:TSJAND:2025:16551`. */
export const ECLI_RE = /ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?/g;

/** Roj: `STS 5053:2025`, `SAP M 5887:2025`, `ATS 4392:2026A`. */
export const ROJ_RE = /[A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?/g;

/** Identificador BOE dentro de una URL de boe.es (`…?id=BOE-A-2021-5773`). */
export const BOE_URL_ID_RE = /boe\.es\/[^\s)]*\bid=(BOE-A-\d{4}-\d+)/;

/** Ruta interna del visor de citas (`/search?id=<id>`). */
export const INTERNAL_VIEWER_ID_RE = /\/search\?id=([^&)\s]+)/;

export function matchAll(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(new RegExp(re.source, "g")), (m) => m[0]);
}
