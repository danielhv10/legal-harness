/**
 * Logotipo "LETRADO" en letras de bloque (estilo Claude Code), 5 filas de alto.
 * Cada letra ocupa 5 columnas; entre letras hay 1 columna de separación.
 */
const GLYPHS: Record<string, string[]> = {
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
};

export const WORDMARK_ROWS = 5;

/** Ancho en columnas del logotipo para un texto y una escala horizontal (1 = normal, 2 = ancho). */
export function wordmarkWidth(text = "LETRADO", scale: 1 | 2 = 1): number {
  const letters = text.length;
  return letters * 5 * scale + (letters - 1) * scale;
}

/**
 * Devuelve las 5 filas del logotipo en texto plano (solo "█" y espacios).
 * Con `scale = 2` cada píxel ocupa dos columnas, como el logotipo de Claude Code.
 */
export function wordmarkLines(text = "LETRADO", scale: 1 | 2 = 1): string[] {
  const rows: string[] = [];
  for (let r = 0; r < WORDMARK_ROWS; r++) {
    const parts: string[] = [];
    for (const ch of text.toUpperCase()) {
      const glyph = GLYPHS[ch];
      const row = glyph ? (glyph[r] ?? "     ") : "     ";
      parts.push(scale === 2 ? row.replace(/./g, (c) => c + c) : row);
    }
    rows.push(parts.join(" ".repeat(scale)).replace(/\s+$/, ""));
  }
  return rows;
}

/** Elige la escala del logotipo que cabe en el ancho interior disponible, o `null` si no cabe. */
export function pickWordmarkScale(innerWidth: number, text = "LETRADO"): 1 | 2 | null {
  if (innerWidth >= wordmarkWidth(text, 2) + 2) return 2;
  if (innerWidth >= wordmarkWidth(text, 1) + 2) return 1;
  return null;
}
