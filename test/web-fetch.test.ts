import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl,
  fetchAsMarkdown,
  htmlToArticleMarkdown,
  isPrivateIp,
} from "../src/lib/web/fetch.js";

const fixtures = join(import.meta.dirname, "fixtures");
const boeHtml = readFileSync(join(fixtures, "boe-page.html"), "utf8");

describe("assertPublicUrl (SSRF)", () => {
  it("acepta URLs públicas http(s)", () => {
    expect(assertPublicUrl("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323").hostname).toBe(
      "www.boe.es",
    );
    expect(assertPublicUrl("http://example.com/x").protocol).toBe("http:");
  });

  it("rechaza localhost e IPs privadas", () => {
    expect(() => assertPublicUrl("http://127.0.0.1/x")).toThrow(/Bloqueado por seguridad/);
    expect(() => assertPublicUrl("http://localhost:3000/")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://10.1.2.3/")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://172.20.0.1/")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://192.168.1.1/")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://[::1]/")).toThrow(/Bloqueado/);
    expect(() => assertPublicUrl("http://0.0.0.0/")).toThrow(/Bloqueado/);
  });

  it("rechaza esquemas distintos de http(s)", () => {
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow(/Solo se permiten URLs http/);
    expect(() => assertPublicUrl("ftp://ftp.example.com/")).toThrow(/Solo se permiten/);
    expect(() => assertPublicUrl("no es una url")).toThrow(/URL no válida/);
  });

  it("isPrivateIp cubre v4, v6 y mapeadas", () => {
    expect(isPrivateIp("172.15.255.255")).toBe(false);
    expect(isPrivateIp("172.16.0.0")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.32.0.0")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("2a00:1450:4003::1")).toBe(false);
  });
});

describe("htmlToArticleMarkdown (Readability)", () => {
  it("extrae el título y el cuerpo del artículo de una página del BOE, sin menús ni pie", () => {
    const { title, markdown } = htmlToArticleMarkdown(
      boeHtml,
      "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323",
    );
    expect(title).toContain("Ley 1/2000, de 7 de enero, de Enjuiciamiento Civil");
    expect(markdown).toContain("Ley 1/2000, de 7 de enero, de Enjuiciamiento Civil");
    expect(markdown).toContain("Artículo 399");
    expect(markdown).toContain("El juicio principiará por demanda");
    expect(markdown).toContain("Artículo 403");
    // Boilerplate fuera del artículo
    expect(markdown).not.toContain("Aviso legal");
    expect(markdown).not.toContain("Suscríbete a las alertas");
    expect(markdown).not.toContain("dataLayer");
  });
});

describe("fetchAsMarkdown", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("descarga HTML y antepone Fuente/Título", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(boeHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    );
    // example.com resuelve a una IP pública real; evitamos depender de DNS forzando una IP pública literal.
    const r = await fetchAsMarkdown("https://93.184.216.34/buscar/act.php?id=BOE-A-2000-323", {
      maxChars: 5000,
    });
    expect(r.kind).toBe("html");
    expect(r.title).toContain("Enjuiciamiento Civil");
    expect(r.markdown.startsWith("Fuente: https://93.184.216.34/")).toBe(true);
    expect(r.markdown).toContain("Título: ");
    expect(r.markdown).toContain("Artículo 399");
    expect(r.bytes).toBe(Buffer.byteLength(boeHtml));
  });

  it("detecta PDFs por content-type y extrae por páginas", async () => {
    const pdf = readFileSync(join(fixtures, "sample.pdf"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } })),
    );
    const r = await fetchAsMarkdown("https://93.184.216.34/docs/sentencia.pdf");
    expect(r.kind).toBe("pdf");
    expect(r.markdown).toContain("--- Página 1 ---");
    expect(r.markdown).toContain("Página dos");
  });

  it("trunca a maxChars e indica el corte", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("a".repeat(5000), { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );
    const r = await fetchAsMarkdown("https://93.184.216.34/texto.txt", { maxChars: 1000 });
    expect(r.kind).toBe("text");
    expect(r.truncated).toBe(true);
    expect(r.markdown).toContain("contenido truncado a 1000 caracteres");
  });

  it("propaga errores HTTP con mensaje en español", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404, statusText: "Not Found" })),
    );
    await expect(fetchAsMarkdown("https://93.184.216.34/nada")).rejects.toThrow(/respondió 404/);
  });

  it("no llega a hacer fetch con URLs bloqueadas", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(fetchAsMarkdown("http://127.0.0.1:8080/admin")).rejects.toThrow(/Bloqueado/);
    await expect(fetchAsMarkdown("file:///etc/passwd")).rejects.toThrow(/Solo se permiten/);
    expect(spy).not.toHaveBeenCalled();
  });
});
