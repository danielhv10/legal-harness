import { parseHTML } from "linkedom";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  /** Fecha de publicación (ISO o texto) si el proveedor la da. */
  published?: string;
}

export interface SearchOptions {
  maxResults: number;
  /** Limitar a estos dominios (p. ej. ["boe.es"]). */
  domains?: string[];
  /** Solo resultados de los últimos N días (si el proveedor lo soporta). */
  recencyDays?: number;
}

export interface SearchProvider {
  name: string;
  search(q: string, opts: SearchOptions, signal?: AbortSignal): Promise<SearchHit[]>;
}

/** Dominios oficiales usados cuando el llamante pide `oficial: true`. */
export const DEFAULT_LEGAL_DOMAINS = [
  "boe.es",
  "poderjudicial.es",
  "tribunalconstitucional.es",
  "eur-lex.europa.eu",
  "agenciatributaria.gob.es",
  "seg-social.es",
  "aepd.es",
  "cnmc.es",
] as const;

const USER_AGENT = "Mozilla/5.0 (compatible; letrado/0.1; +https://github.com/letrado)";

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  provider: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: withTimeout(signal, 20_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error de red al consultar ${provider}: ${msg}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${provider} respondió ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return (await res.json()) as T;
}

function clampResults(hits: SearchHit[], max: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (!h.url || seen.has(h.url)) continue;
    seen.add(h.url);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// DuckDuckGo (HTML, sin clave)
// ---------------------------------------------------------------------------

/** Decodifica un enlace de redirección de DDG (`//duckduckgo.com/l/?uddg=<url>`). */
export function decodeDuckDuckGoUrl(href: string): string {
  let h = href.trim();
  if (h.startsWith("//")) h = `https:${h}`;
  try {
    const u = new URL(h, "https://duckduckgo.com");
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const target = u.searchParams.get("uddg");
      if (target) return target;
    }
    return u.toString();
  } catch {
    return h;
  }
}

/** Extrae resultados del HTML de `html.duckduckgo.com`. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const { document } = parseHTML(html);
  const hits: SearchHit[] = [];
  const anchors = document.querySelectorAll("a.result__a");
  for (const a of anchors) {
    const href = a.getAttribute("href") ?? "";
    const url = decodeDuckDuckGoUrl(href);
    if (!/^https?:\/\//.test(url)) continue;
    // Anuncios: enlaces hacia duckduckgo.com/y.js o bing aclick.
    if (/duckduckgo\.com\/y\.js|bing\.com\/aclick/.test(url)) continue;
    const container = a.closest(".result") ?? a.parentElement?.parentElement ?? a.parentElement;
    const snippetEl = container?.querySelector(".result__snippet");
    const title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const snippet = (snippetEl?.textContent ?? "").replace(/\s+/g, " ").trim();
    hits.push({ title: title || url, url, snippet });
  }
  return hits;
}

export const duckduckgoProvider: SearchProvider = {
  name: "duckduckgo",
  async search(q, opts, signal) {
    let query = q.trim();
    if (opts.domains && opts.domains.length > 0) {
      const sites = opts.domains.map((d) => `site:${d.replace(/^\*\./, "")}`);
      query = sites.length === 1 ? `${query} ${sites[0]}` : `${query} (${sites.join(" OR ")})`;
    }
    const params = new URLSearchParams({ q: query, kl: "es-es" });
    if (opts.recencyDays !== undefined) {
      params.set(
        "df",
        opts.recencyDays <= 1 ? "d" : opts.recencyDays <= 7 ? "w" : opts.recencyDays <= 31 ? "m" : "y",
      );
    }
    const url = `https://html.duckduckgo.com/html/?${params.toString()}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "es-ES,es;q=0.9" },
        signal: withTimeout(signal, 20_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Error de red al consultar DuckDuckGo: ${msg}`);
    }
    if (!res.ok) throw new Error(`DuckDuckGo respondió ${res.status} ${res.statusText}`);
    const html = await res.text();
    if (/anomaly|bots\b|captcha/i.test(html) && !/result__a/.test(html)) {
      throw new Error(
        "DuckDuckGo ha bloqueado temporalmente la consulta (detección de automatización). Inténtalo más tarde o configura TAVILY_API_KEY/BRAVE_API_KEY/EXA_API_KEY.",
      );
    }
    return clampResults(parseDuckDuckGoHtml(html), opts.maxResults);
  },
};

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
}

export function tavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(q, opts, signal) {
      const body: Record<string, unknown> = {
        query: q,
        max_results: Math.min(Math.max(opts.maxResults, 1), 20),
        search_depth: "basic",
        include_answer: false,
      };
      if (opts.domains && opts.domains.length > 0) body.include_domains = opts.domains;
      if (opts.recencyDays !== undefined) body.days = opts.recencyDays;
      const data = await fetchJson<TavilyResponse>(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        },
        signal,
        "Tavily",
      );
      const hits: SearchHit[] = (data.results ?? []).map((r) => ({
        title: r.title ?? r.url ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        published: r.published_date,
      }));
      return clampResults(hits, opts.maxResults);
    },
  };
}

// ---------------------------------------------------------------------------
// Brave
// ---------------------------------------------------------------------------

interface BraveResponse {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string; age?: string; page_age?: string }>;
  };
}

export function braveProvider(apiKey: string): SearchProvider {
  return {
    name: "brave",
    async search(q, opts, signal) {
      let query = q;
      if (opts.domains && opts.domains.length > 0) {
        const sites = opts.domains.map((d) => `site:${d.replace(/^\*\./, "")}`);
        query = `${q} ${sites.length === 1 ? sites[0] : `(${sites.join(" OR ")})`}`;
      }
      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(Math.max(opts.maxResults, 1), 20)),
        country: "ES",
        search_lang: "es",
      });
      if (opts.recencyDays !== undefined) {
        params.set(
          "freshness",
          opts.recencyDays <= 1 ? "pd" : opts.recencyDays <= 7 ? "pw" : opts.recencyDays <= 31 ? "pm" : "py",
        );
      }
      const data = await fetchJson<BraveResponse>(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
        signal,
        "Brave Search",
      );
      const hits: SearchHit[] = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? r.url ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
        published: r.page_age ?? r.age,
      }));
      return clampResults(hits, opts.maxResults);
    },
  };
}

// ---------------------------------------------------------------------------
// Exa
// ---------------------------------------------------------------------------

interface ExaResponse {
  results?: Array<{
    title?: string | null;
    url?: string;
    text?: string;
    highlights?: string[];
    publishedDate?: string;
  }>;
}

export function exaProvider(apiKey: string): SearchProvider {
  return {
    name: "exa",
    async search(q, opts, signal) {
      const body: Record<string, unknown> = {
        query: q,
        numResults: Math.min(Math.max(opts.maxResults, 1), 25),
        type: "auto",
        contents: { highlights: { maxCharacters: 400 } },
      };
      if (opts.domains && opts.domains.length > 0) body.includeDomains = opts.domains;
      if (opts.recencyDays !== undefined) {
        body.startPublishedDate = new Date(Date.now() - opts.recencyDays * 86_400_000).toISOString();
      }
      const data = await fetchJson<ExaResponse>(
        "https://api.exa.ai/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify(body),
        },
        signal,
        "Exa",
      );
      const hits: SearchHit[] = (data.results ?? []).map((r) => ({
        title: r.title ?? r.url ?? "",
        url: r.url ?? "",
        snippet: r.highlights?.join(" … ") ?? r.text?.slice(0, 400) ?? "",
        published: r.publishedDate,
      }));
      return clampResults(hits, opts.maxResults);
    },
  };
}

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

export type SearchProviderName = "duckduckgo" | "tavily" | "brave" | "exa";

export interface ResolvedProvider {
  provider: SearchProvider;
  /** true si no había clave y se usó duckduckgo por defecto. */
  fallback: boolean;
  /** Aviso en español si `LETRADO_WEB_SEARCH` pedía un proveedor sin clave. */
  warning?: string;
}

const KEY_ENV: Record<Exclude<SearchProviderName, "duckduckgo">, string> = {
  tavily: "TAVILY_API_KEY",
  brave: "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
};

function buildProvider(name: SearchProviderName, key: string | undefined): SearchProvider | undefined {
  switch (name) {
    case "duckduckgo":
      return duckduckgoProvider;
    case "tavily":
      return key ? tavilyProvider(key) : undefined;
    case "brave":
      return key ? braveProvider(key) : undefined;
    case "exa":
      return key ? exaProvider(key) : undefined;
    default:
      return undefined;
  }
}

/**
 * Elige el proveedor: `LETRADO_WEB_SEARCH` si está definido (y tiene clave),
 * si no la primera clave presente (tavily → brave → exa), y por defecto duckduckgo.
 */
export function resolveSearchProvider(env: NodeJS.ProcessEnv = process.env): ResolvedProvider {
  const requested = env.LETRADO_WEB_SEARCH?.trim().toLowerCase() as SearchProviderName | undefined;
  if (requested) {
    if (requested === "duckduckgo") return { provider: duckduckgoProvider, fallback: false };
    const envName = KEY_ENV[requested as keyof typeof KEY_ENV];
    if (!envName) {
      return {
        provider: duckduckgoProvider,
        fallback: true,
        warning: `Proveedor desconocido en LETRADO_WEB_SEARCH="${env.LETRADO_WEB_SEARCH}" (válidos: duckduckgo, tavily, brave, exa). Se usa duckduckgo.`,
      };
    }
    const key = env[envName]?.trim();
    const provider = buildProvider(requested, key);
    if (provider) return { provider, fallback: false };
    return {
      provider: duckduckgoProvider,
      fallback: true,
      warning: `LETRADO_WEB_SEARCH=${requested} pero falta ${envName}. Se usa duckduckgo.`,
    };
  }
  for (const name of ["tavily", "brave", "exa"] as const) {
    const key = env[KEY_ENV[name]]?.trim();
    if (key) return { provider: buildProvider(name, key) as SearchProvider, fallback: false };
  }
  return { provider: duckduckgoProvider, fallback: true };
}

/** Formatea resultados para el modelo. */
export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "Sin resultados.";
  return hits
    .map((h, i) => {
      const lines = [`${i + 1}. ${h.title}`, `   URL: ${h.url}`];
      if (h.published) lines.push(`   Fecha: ${h.published}`);
      if (h.snippet) lines.push(`   ${h.snippet}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
