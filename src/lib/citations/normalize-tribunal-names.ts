/**
 * Post-processing utility for normalizing tribunal names in AI responses.
 *
 * Transforms old tribunal names (pre-2025) to new nomenclature (CGPJ 2025 reform)
 * in the text output. This ensures consistent terminology regardless of LLM behavior.
 */

/**
 * Mapping of old tribunal names to new names (2025 reform).
 * Keys are sorted by length (longest first) to avoid partial replacements.
 */
const OLD_TO_NEW_TRIBUNAL_NAMES: [string, string][] = [
  // Audiencia Nacional Juzgados Centrales → Tribunal Central de Instancia
  [
    "Audiencia Nacional. Juzgado Central de Vigilancia Penitenciaria",
    "Tribunal Central de Instancia. Sección de Vigilancia Penitenciaria",
  ],
  [
    "Audiencia Nacional. Juzgado Central de lo Contencioso-Administrativo",
    "Tribunal Central de Instancia. Sección de lo Contencioso-Administrativo",
  ],
  [
    "Audiencia Nacional. Juzgado Central de Instrucción",
    "Tribunal Central de Instancia. Sección de Instrucción",
  ],
  ["Audiencia Nacional. Juzgado Central de Menores", "Tribunal Central de Instancia. Sección de Menores"],
  ["Audiencia Nacional. Juzgado Central de lo Penal", "Tribunal Central de Instancia. Sección de lo Penal"],
  // Juzgados with location suffixes (use regex patterns below)
  ["Juzgado de Primera Instancia e Instrucción", "Tribunal de Instancia. Sección Civil y de Instrucción"],
  ["Juzgado de Vigilancia Penitenciaria", "Tribunal de Instancia. Sección de Vigilancia Penitenciaria"],
  [
    "Juzgado de lo Contencioso-Administrativo",
    "Tribunal de Instancia. Sección de lo Contencioso-Administrativo",
  ],
  ["Juzgado de Violencia Sobre la Mujer", "Tribunal de Instancia. Sección de Violencia sobre la Mujer"],
  ["Juzgado de Primera Instancia", "Tribunal de Instancia. Sección Civil"],
  ["Juzgado de lo Mercantil", "Tribunal de Instancia. Sección de lo Mercantil"],
  ["Juzgado de Instrucción", "Tribunal de Instancia. Sección de Instrucción"],
  ["Juzgado de lo Social", "Tribunal de Instancia. Sección de lo Social"],
  ["Juzgado de lo Penal", "Tribunal de Instancia. Sección de lo Penal"],
  ["Juzgado de Menores", "Tribunal de Instancia. Sección de Menores"],
  ["Juzgado de Paz", "Oficina de Justicia en el municipio"],
];

/**
 * Normalizes tribunal names in text from old nomenclature to new (CGPJ 2025).
 *
 * This function performs case-insensitive replacement while preserving
 * the original text structure. It handles tribunal names with location
 * suffixes (e.g., "Juzgado de Primera Instancia de Madrid").
 *
 * @param text - The text containing tribunal names to normalize
 * @returns Text with old tribunal names replaced by new nomenclature
 *
 * @example
 * normalizeTribunalNames("El Juzgado de Primera Instancia de Madrid dictó...")
 * // Returns: "El Tribunal de Instancia. Sección Civil de Madrid dictó..."
 */
export function normalizeTribunalNames(text: string): string {
  if (!text) return text;

  let result = text;

  // Apply replacements in order (longest first to avoid partial matches)
  for (const [oldName, newName] of OLD_TO_NEW_TRIBUNAL_NAMES) {
    // Escape special regex characters in the old name
    const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Simple case-insensitive replacement
    const pattern = new RegExp(escapedOldName, "gi");

    result = result.replace(pattern, newName);
  }

  return result;
}

/**
 * Check if text contains any old tribunal names that should be normalized.
 *
 * @param text - The text to check
 * @returns true if text contains old tribunal names
 */
export function hasOldTribunalNames(text: string): boolean {
  if (!text) return false;

  const lowerText = text.toLowerCase();
  return OLD_TO_NEW_TRIBUNAL_NAMES.some(([oldName]) => lowerText.includes(oldName.toLowerCase()));
}
