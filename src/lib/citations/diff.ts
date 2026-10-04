/**
 * Diferencia entre el texto generado y el texto saneado: qué enlaces y qué
 * identificadores Roj/ECLI desaparecieron. Alimenta `/citas` y la notificación
 * de fin de turno.
 */

import { ECLI_RE, LINK_RE, matchAll, ROJ_RE } from "./patterns.js";

export interface StrippedCitation {
  kind: "url" | "roj" | "ecli";
  /** URL, código Roj o código ECLI eliminado. */
  value: string;
  /** Etiqueta del enlace (solo `kind === "url"`). */
  label?: string;
}

export function diffCitations(before: string, after: string): StrippedCitation[] {
  if (before === after) return [];
  const out: StrippedCitation[] = [];
  const seen = new Set<string>();
  const push = (s: StrippedCitation) => {
    const key = `${s.kind}:${s.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  const afterUrls = new Set(Array.from(after.matchAll(new RegExp(LINK_RE.source, "g")), (m) => m[2]));
  for (const m of before.matchAll(new RegExp(LINK_RE.source, "g"))) {
    const label = m[1] ?? "";
    const url = m[2] ?? "";
    if (!afterUrls.has(url) && !after.includes(url)) push({ kind: "url", value: url, label });
  }

  // Los ECLI antes que los Roj: el patrón Roj no casa dentro de un ECLI (los dos
  // puntos lo impiden), pero mantenemos el orden por claridad.
  const afterEclis = new Set(matchAll(after, ECLI_RE));
  for (const code of matchAll(before, ECLI_RE))
    if (!afterEclis.has(code)) push({ kind: "ecli", value: code });

  const afterRojs = new Set(matchAll(after, ROJ_RE));
  for (const code of matchAll(before, ROJ_RE)) if (!afterRojs.has(code)) push({ kind: "roj", value: code });

  return out;
}
