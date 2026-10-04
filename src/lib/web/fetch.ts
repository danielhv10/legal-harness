import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { letradoVersion } from "../../version.js";
import { htmlToMarkdown } from "../docx-read.js";
import { extractPdfText } from "../pdf.js";

export interface FetchOptions {
  /** Máximo de caracteres del cuerpo Markdown (por defecto 40 000). */
  maxChars?: number;
  signal?: AbortSignal;
  /** Tiempo máximo en ms (por defecto 20 000). */
  timeoutMs?: number;
}

export interface FetchResult {
  /** URL final tras redirecciones. */
  url: string;
  title: string;
  /** Texto con cabecera `Fuente:`/`Título:` y el contenido en Markdown. */
  markdown: string;
  kind: "html" | "pdf" | "text";
  /** Bytes descargados. */
  bytes: number;
  /** true si `markdown` se truncó a `maxChars`. */
  truncated: boolean;
}

export const DEFAULT_MAX_CHARS = 40_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// SSRF
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** true si la IP (v4 o v6) es privada, loopback, link-local o no enrutable. */
export function isPrivateIp(ip: string): boolean {
  let addr = ip.trim();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const v = isIP(addr);
  if (v === 4) {
    return (
      inCidr4(addr, "127.0.0.0", 8) ||
      inCidr4(addr, "10.0.0.0", 8) ||
      inCidr4(addr, "172.16.0.0", 12) ||
      inCidr4(addr, "192.168.0.0", 16) ||
      inCidr4(addr, "169.254.0.0", 16) ||
      inCidr4(addr, "0.0.0.0", 8) ||
      inCidr4(addr, "100.64.0.0", 10)
    );
  }
  if (v === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // IPv4 mapeada: ::ffff:a.b.c.d
    const m = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (m?.[1]) return isPrivateIp(m[1]);
    return false;
  }
  return false;
}

/**
 * Comprueba de forma síncrona que la URL es http(s) y no apunta a localhost ni a IPs privadas
 * literales. Lanza con mensaje en español. Devuelve la URL parseada.
 */
export function assertPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`URL no válida: "${input}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Solo se permiten URLs http(s); se recibió "${url.protocol}"`);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0") {
    throw new Error(`Bloqueado por seguridad: no se permite acceder a "${host}"`);
  }
  if (isPrivateIp(host)) {
    throw new Error(`Bloqueado por seguridad: "${host}" es una dirección privada o local`);
  }
  if (url.username || url.password) {
    throw new Error("Bloqueado por seguridad: no se permiten credenciales en la URL");
  }
  return url;
}

/** Como `assertPublicUrl`, pero además resuelve el DNS y rechaza nombres que apunten a IPs privadas. */
export async function assertPublicUrlResolved(input: string): Promise<URL> {
  const url = assertPublicUrl(input);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return url;
  try {
    const addrs = await lookup(url.hostname, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        throw new Error(
          `Bloqueado por seguridad: "${url.hostname}" resuelve a una dirección privada (${a.address})`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Bloqueado")) throw err;
    throw new Error(`No se pudo resolver el dominio "${url.hostname}"`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function userAgent(): string {
  return `letrado/${letradoVersion()} (+agente jurídico)`;
}

async function readBody(res: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `El recurso es demasiado grande (${(declared / 1024 / 1024).toFixed(1)} MB; máximo 25 MB)`,
    );
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal.aborted) throw new Error("Descarga cancelada o tiempo de espera agotado");
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("El recurso supera los 25 MB permitidos");
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType);
  const charset = m?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function sniffCharsetFromHtml(html: string): string | undefined {
  const m = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(html.slice(0, 4096));
  return m?.[1]?.toLowerCase();
}

export interface HtmlToArticle {
  title: string;
  markdown: string;
}

/** HTML → Readability → Markdown. Si Readability falla, usa el <body> completo. */
export function htmlToArticleMarkdown(html: string, baseUrl?: string): HtmlToArticle {
  const { document } = parseHTML(html);
  if (baseUrl) {
    try {
      // Readability usa document.baseURI / documentURI para resolver enlaces.
      Object.defineProperty(document, "documentURI", { value: baseUrl, configurable: true });
      Object.defineProperty(document, "baseURI", { value: baseUrl, configurable: true });
    } catch {
      // ignorar
    }
  }
  const docTitle = (document.querySelector("title")?.textContent ?? "").replace(/\s+/g, " ").trim();
  let article: ReturnType<Readability["parse"]> = null;
  try {
    // Readability muta el DOM: clonamos para conservar el título original.
    article = new Readability(
      document.cloneNode(true) as unknown as ConstructorParameters<typeof Readability>[0],
      { charThreshold: 200 },
    ).parse();
  } catch {
    article = null;
  }
  const title = (article?.title ?? "").trim() || docTitle || "(sin título)";
  let contentHtml = article?.content ?? "";
  if (!contentHtml || contentHtml.replace(/<[^>]+>/g, "").trim().length < 50) {
    for (const sel of ["script", "style", "noscript", "nav", "header", "footer", "iframe", "svg"]) {
      for (const el of document.querySelectorAll(sel)) el.remove();
    }
    contentHtml = document.body?.innerHTML ?? document.documentElement?.innerHTML ?? html;
  }
  let markdown = htmlToMarkdown(contentHtml);
  if (title && !markdown.startsWith(`# ${title}`)) markdown = `# ${title}\n\n${markdown}`;
  return { title, markdown };
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[… contenido truncado a ${maxChars} caracteres; aumenta max_chars para ver más]`,
    truncated: true,
  };
}

/**
 * Descarga una URL pública y la devuelve como Markdown (HTML vía Readability, PDF vía unpdf,
 * texto plano tal cual). Cabecera `Fuente:`/`Título:` al principio.
 */
export async function fetchAsMarkdown(input: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const url = await assertPublicUrlResolved(input);
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal,
      headers: {
        "User-Agent": userAgent(),
        Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.5",
      },
    });
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === "TimeoutError")) {
      throw new Error(`Tiempo de espera agotado al descargar ${url.hostname} (20 s)`);
    }
    const msg =
      err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    throw new Error(`No se pudo descargar la URL: ${msg}`);
  }
  if (!res.ok) {
    throw new Error(
      `El servidor respondió ${res.status} ${res.statusText} para ${res.url || url.toString()}`,
    );
  }
  const finalUrl = res.url || url.toString();
  // Si hubo redirección, volver a comprobar el destino.
  if (finalUrl !== url.toString()) assertPublicUrl(finalUrl);

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await readBody(res, signal);
  const pathname = (() => {
    try {
      return new URL(finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const isPdf =
    contentType.includes("application/pdf") ||
    contentType.includes("application/x-pdf") ||
    pathname.endsWith(".pdf") ||
    (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

  let kind: FetchResult["kind"];
  let title: string;
  let body: string;

  if (isPdf) {
    kind = "pdf";
    const pdf = await extractPdfText(bytes, { signal: opts.signal });
    title = pathname.split("/").pop() || "documento.pdf";
    body = pdf.scanned
      ? `[El PDF no tiene capa de texto (${pdf.totalPages} páginas); probablemente es un escaneo y requiere OCR]`
      : pdf.text;
    if (pdf.totalPages > pdf.pages.length) {
      body += `\n\n[Mostradas ${pdf.pages.length} de ${pdf.totalPages} páginas]`;
    }
  } else if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    (!contentType.includes("text/plain") &&
      /^\s*<(!doctype|html|head|body)/i.test(decodeText(bytes.subarray(0, 512), contentType)))
  ) {
    kind = "html";
    let html = decodeText(bytes, contentType);
    if (!/charset=/i.test(contentType)) {
      const sniffed = sniffCharsetFromHtml(html);
      if (sniffed && sniffed !== "utf-8" && sniffed !== "utf8")
        html = decodeText(bytes, `charset=${sniffed}`);
    }
    const article = htmlToArticleMarkdown(html, finalUrl);
    title = article.title;
    body = article.markdown;
  } else {
    kind = "text";
    title = pathname.split("/").pop() || finalUrl;
    body = decodeText(bytes, contentType);
  }

  const { text, truncated } = truncate(body.trim(), maxChars);
  const markdown = `Fuente: ${finalUrl}\nTítulo: ${title}\n\n${text}`;
  return { url: finalUrl, title, markdown, kind, bytes: bytes.length, truncated };
}
