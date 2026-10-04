/**
 * Recolecta las citas realmente servidas por una herramienta (MCP o web) para
 * alimentar el guardarraíl: el conjunto `AllowedCitations` que `sanitizeCitations`
 * usa como lista blanca y una lista legible (`ServedCitation[]`) para `/citas`.
 *
 * Fuentes, por orden de preferencia:
 *   1. `structuredContent.citations[]` / `structuredContent.allowed_citations`
 *      (salida estructurada de `research`/`search_legal`/`get_document`).
 *   2. El texto de los bloques (`- Enlace: …`, `Vigencia: …`), vía
 *      `extractAllowedCitations`, como respaldo y complemento.
 *
 * Pi envuelve los resultados MCP: el `structuredContent` del evento es el
 * `CallToolResult` completo (`{ content, structuredContent, isError }`), así que
 * se desenvuelve un nivel cuando hace falta.
 */

import { BOE_URL_ID_RE, ECLI_RE, INTERNAL_VIEWER_ID_RE, LINK_RE, matchAll, ROJ_RE } from "./patterns.js";
import { type AllowedCitations, extractAllowedCitations } from "./sanitize-citations.js";

export interface ServedCitation {
  label: string;
  url?: string;
  roj?: string;
  ecli?: string;
  docKey?: string;
  date?: string;
  vigencia?: string;
  source: "mcp" | "web";
}

export interface HarvestResult {
  allowed: AllowedCitations;
  served: ServedCitation[];
}

interface StructuredCitation {
  url?: unknown;
  roj?: unknown;
  ecli?: unknown;
  label?: unknown;
  title?: unknown;
  doc_key?: unknown;
  date?: unknown;
  vigencia?: unknown;
  boe_id?: unknown;
}

interface StructuredPayload {
  citations?: unknown;
  allowed_citations?: unknown;
  session_state?: unknown;
  structuredContent?: unknown;
}

export function emptyAllowed(): AllowedCitations {
  return {
    urls: new Set(),
    rojs: new Set(),
    eclis: new Set(),
    internalLabels: new Map(),
    internalIds: new Set(),
    rojToEcli: new Map(),
    boeUrls: new Map(),
  };
}

export function isAllowedEmpty(a: AllowedCitations): boolean {
  return (
    a.urls.size === 0 &&
    a.rojs.size === 0 &&
    a.eclis.size === 0 &&
    a.internalIds.size === 0 &&
    a.boeUrls.size === 0
  );
}

/** Unión de dos listas blancas (no muta los argumentos). */
export function mergeAllowed(a: AllowedCitations, b: AllowedCitations): AllowedCitations {
  const out = emptyAllowed();
  for (const src of [a, b]) {
    for (const u of src.urls) out.urls.add(u);
    for (const r of src.rojs) out.rojs.add(r);
    for (const e of src.eclis) out.eclis.add(e);
    for (const id of src.internalIds) out.internalIds.add(id);
    for (const [k, v] of src.internalLabels) if (!out.internalLabels.has(k)) out.internalLabels.set(k, v);
    for (const [k, v] of src.rojToEcli) if (!out.rojToEcli.has(k)) out.rojToEcli.set(k, v);
    for (const [k, v] of src.boeUrls) {
      const existing = out.boeUrls.get(k);
      // Preferir la URL sin ancla (nivel norma), como hace extractAllowedCitations.
      if (!existing || (existing.includes("#") && !v.includes("#"))) out.boeUrls.set(k, v);
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Desenvuelve el `CallToolResult` que Pi coloca en `structuredContent` para herramientas MCP. */
export function unwrapStructured(structuredContent: unknown): StructuredPayload | undefined {
  if (!isRecord(structuredContent)) return undefined;
  const sc = structuredContent as StructuredPayload;
  if (sc.citations !== undefined || sc.allowed_citations !== undefined || sc.session_state !== undefined)
    return sc;
  if (isRecord(sc.structuredContent))
    return unwrapStructured(sc.structuredContent) ?? (sc.structuredContent as StructuredPayload);
  return sc;
}

/** `session_state` de un resultado de `research`, si existe. */
export function extractSessionState(structuredContent: unknown): unknown {
  const sc = unwrapStructured(structuredContent);
  return sc?.session_state;
}

/** Añade a `allowed` los identificadores de una cita estructurada. */
function addCitationToAllowed(allowed: AllowedCitations, c: ServedCitation): void {
  if (c.url) {
    allowed.urls.add(c.url);
    const idMatch = INTERNAL_VIEWER_ID_RE.exec(c.url);
    if (idMatch?.[1]) {
      allowed.internalLabels.set(c.url, c.label);
      if (/^\d+$/.test(idMatch[1])) allowed.internalIds.add(idMatch[1]);
    }
    const boeMatch = BOE_URL_ID_RE.exec(c.url);
    if (boeMatch?.[1]) {
      const existing = allowed.boeUrls.get(boeMatch[1]);
      if (!existing || (existing.includes("#") && !c.url.includes("#")))
        allowed.boeUrls.set(boeMatch[1], c.url);
    }
  }
  if (c.roj) allowed.rojs.add(c.roj);
  if (c.ecli) allowed.eclis.add(c.ecli);
  if (c.roj && c.ecli) allowed.rojToEcli.set(c.roj, c.ecli);
}

function fromStructuredCitations(raw: unknown): ServedCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: ServedCitation[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const c = item as StructuredCitation;
    const url = str(c.url);
    const label = str(c.label) ?? str(c.title) ?? url ?? str(c.doc_key);
    if (!label) continue;
    out.push({
      label,
      url,
      roj: str(c.roj),
      ecli: str(c.ecli),
      docKey: str(c.doc_key),
      date: str(c.date),
      vigencia: str(c.vigencia),
      source: "mcp",
    });
  }
  return out;
}

function addAllowedList(allowed: AllowedCitations, raw: unknown): void {
  if (!isRecord(raw)) return;
  const lists: Array<[keyof Pick<AllowedCitations, "urls" | "rojs" | "eclis">, unknown]> = [
    ["urls", raw.urls],
    ["rojs", raw.rojs],
    ["eclis", raw.eclis],
  ];
  for (const [key, list] of lists) {
    if (!Array.isArray(list)) continue;
    for (const v of list) if (typeof v === "string" && v) allowed[key].add(v);
  }
}

// Cabecera de documento en los bloques del MCP: `- Enlace: <cabecera> (fecha: YYYY-MM-DD)`.
const ENLACE_LINE_RE = /^- Enlace: (.+?)(?: \(fecha: ([^)]*)\))?\s*$/;
/** Línea de documento sin "Enlace:" (sentencias/resoluciones sin URL pública). */
const PLAIN_DOC_LINE_RE = /^- (?!Enlace:)(.+?)\s*\(fecha:\s*([^)]*)\)\s*$/;
const VIGENCIA_LINE_RE = /^\s+Vigencia: (.+?)\s*$/;

/** Lista legible de documentos a partir del texto de bloques (`- Enlace:` + `Vigencia:`). */
export function servedFromText(text: string): ServedCitation[] {
  const out: ServedCitation[] = [];
  let current: ServedCitation | undefined;
  for (const line of text.split("\n")) {
    const enlace = ENLACE_LINE_RE.exec(line);
    if (enlace) {
      const header = enlace[1] ?? "";
      const link = new RegExp(LINK_RE.source).exec(header);
      const label = (link ? link[1] : header)?.trim() ?? header;
      current = {
        label,
        url: link?.[2],
        roj: matchAll(label, ROJ_RE)[0],
        ecli: matchAll(label, ECLI_RE)[0],
        date: enlace[2] || undefined,
        source: "mcp",
      };
      out.push(current);
      continue;
    }
    // Documento sin visor público: "- <etiqueta> (Roj: … · ECLI: …) (fecha: AAAA-MM-DD)".
    const plain = PLAIN_DOC_LINE_RE.exec(line);
    if (plain) {
      const label = (plain[1] ?? "").trim();
      current = {
        label,
        roj: matchAll(label, ROJ_RE)[0],
        ecli: matchAll(label, ECLI_RE)[0],
        date: plain[2] || undefined,
        source: "mcp",
      };
      out.push(current);
      continue;
    }
    const vig = current ? VIGENCIA_LINE_RE.exec(line) : null;
    if (vig && current) current.vigencia = vig[1];
    else if (!/^\s/.test(line)) current = undefined;
  }
  return out;
}

function citationKey(c: ServedCitation): string {
  return c.url ?? c.ecli ?? c.roj ?? c.docKey ?? c.label;
}

export function dedupeServed(list: ServedCitation[]): ServedCitation[] {
  const seen = new Set<string>();
  const out: ServedCitation[] = [];
  for (const c of list) {
    const key = citationKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Cosecha las citas de un resultado de herramienta. Combina el texto y el
 * contenido estructurado: la lista blanca es la unión de ambos; la lista
 * legible prefiere la estructurada y recurre al texto si aquella no existe.
 */
export function harvestFromToolResult(
  _toolName: string,
  content: Array<{ type: string; text?: string }>,
  structuredContent: unknown,
): HarvestResult {
  const text = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");

  let allowed = text ? extractAllowedCitations(text) : emptyAllowed();
  let served: ServedCitation[] = [];

  const sc = unwrapStructured(structuredContent);
  if (sc) {
    const structured = fromStructuredCitations(sc.citations);
    const extra = emptyAllowed();
    for (const c of structured) addCitationToAllowed(extra, c);
    addAllowedList(extra, sc.allowed_citations);
    allowed = mergeAllowed(allowed, extra);
    served = structured;
  }
  if (served.length === 0 && text) served = servedFromText(text);

  return { allowed, served: dedupeServed(served) };
}

/** URL final de un resultado de `web_fetch` (`details.url`, o `finalUrl` si la hubiera). */
export function urlsFromWebFetch(details: unknown): string[] {
  if (!isRecord(details)) return [];
  const out: string[] = [];
  for (const key of ["url", "finalUrl"]) {
    const v = details[key];
    if (typeof v === "string" && /^https?:\/\//.test(v)) out.push(v);
  }
  return Array.from(new Set(out));
}

/** URLs de los resultados de `web_search` (`details.hits[].url`). */
export function urlsFromWebSearch(details: unknown): string[] {
  if (!isRecord(details) || !Array.isArray(details.hits)) return [];
  const out: string[] = [];
  for (const hit of details.hits) {
    if (isRecord(hit) && typeof hit.url === "string" && /^https?:\/\//.test(hit.url)) out.push(hit.url);
  }
  return Array.from(new Set(out));
}
