/**
 * Plazos del expediente: parseo puro de la sección `## Plazos próximos` de EXPEDIENTE.md.
 *
 * Formatos aceptados por línea (lista con `-` o `*`):
 *   - [dd/mm/aaaa] — actuación
 *   - dd/mm/aaaa — actuación
 *   - aaaa-mm-dd — actuación
 * Las líneas de plantilla que contienen literalmente `[dd/mm/aaaa]` se ignoran.
 */

export interface Plazo {
  date: Date;
  text: string;
}

export type PlazoEstado = "pasado" | "inminente" | "pendiente";

/** Días a partir de los cuales un plazo deja de considerarse inminente. */
export const DIAS_INMINENTE = 7;

const SECTION_RE = /^##\s+Plazos\b/i;
const HEADING_RE = /^#{1,6}\s/;
const ITEM_RE = /^\s*[-*•]\s+(.*)$/;
const DMY_RE = /\[?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*\]?/;
const ISO_RE = /\[?\s*(\d{4})-(\d{2})-(\d{2})\s*\]?/;
const PLACEHOLDER_RE = /\[\s*dd\/mm\/aaaa\s*\]/i;
const SEPARATOR_RE = /^\s*(?:[—–-]|:)\s*/;

function makeDate(year: number, month: number, day: number): Date | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  return d;
}

/** Extrae la primera fecha de una línea; devuelve la fecha y el texto restante. */
export function parsePlazoLine(line: string): Plazo | undefined {
  if (PLACEHOLDER_RE.test(line)) return undefined;
  let m = line.match(DMY_RE);
  let date: Date | undefined;
  if (m) {
    date = makeDate(Number(m[3]), Number(m[2]), Number(m[1]));
  } else {
    m = line.match(ISO_RE);
    if (m) date = makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (!m || !date || m.index === undefined) return undefined;
  const before = line.slice(0, m.index).trim();
  const after = line
    .slice(m.index + m[0].length)
    .replace(SEPARATOR_RE, "")
    .trim();
  const text = (after || before.replace(/[—–:-]\s*$/, "").trim()).replace(/\*\*/g, "").trim();
  return { date, text };
}

/** Lee la sección `## Plazos próximos` (hasta el siguiente encabezado) y devuelve los plazos ordenados. */
export function parsePlazos(md: string | undefined): Plazo[] {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const plazos: Plazo[] = [];
  let inSection = false;
  for (const raw of lines) {
    if (SECTION_RE.test(raw)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (HEADING_RE.test(raw)) break;
    const item = raw.match(ITEM_RE);
    if (!item?.[1]) continue;
    const plazo = parsePlazoLine(item[1]);
    if (plazo) plazos.push(plazo);
  }
  return plazos.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Días naturales entre hoy y el plazo (negativo si ya pasó). */
export function diasHasta(plazo: Plazo, now: Date = new Date()): number {
  const ms = startOfDay(plazo.date).getTime() - startOfDay(now).getTime();
  return Math.round(ms / 86_400_000);
}

export function estadoPlazo(plazo: Plazo, now: Date = new Date()): PlazoEstado {
  const d = diasHasta(plazo, now);
  if (d < 0) return "pasado";
  if (d <= DIAS_INMINENTE) return "inminente";
  return "pendiente";
}

/**
 * Próximo plazo: el más cercano de hoy en adelante. Si todos han vencido,
 * devuelve el vencido más reciente para que el usuario vea que está fuera de plazo.
 */
export function nextPlazo(plazos: Plazo[], now: Date = new Date()): Plazo | undefined {
  if (plazos.length === 0) return undefined;
  const today = startOfDay(now).getTime();
  const sorted = [...plazos].sort((a, b) => a.date.getTime() - b.date.getTime());
  const upcoming = sorted.find((p) => startOfDay(p.date).getTime() >= today);
  return upcoming ?? sorted[sorted.length - 1];
}

export function formatPlazoDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** `dd/mm/aaaa — actuación` (sin color). */
export function formatPlazo(plazo: Plazo): string {
  return plazo.text ? `${formatPlazoDate(plazo.date)} — ${plazo.text}` : formatPlazoDate(plazo.date);
}
