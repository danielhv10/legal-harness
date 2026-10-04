import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LEGAL_DOMAINS,
  decodeDuckDuckGoUrl,
  duckduckgoProvider,
  formatSearchHits,
  parseDuckDuckGoHtml,
  resolveSearchProvider,
} from "../src/lib/web/search.js";

const ddgHtml = readFileSync(join(import.meta.dirname, "fixtures", "ddg.html"), "utf8");

describe("decodeDuckDuckGoUrl", () => {
  it("decodifica el parámetro uddg de los enlaces de redirección", () => {
    expect(
      decodeDuckDuckGoUrl(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.boe.es%2Fbuscar%2Fact.php%3Fid%3DBOE-A-1889-4763&rut=abc",
      ),
    ).toBe("https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763");
  });

  it("deja intactas las URLs directas", () => {
    expect(decodeDuckDuckGoUrl("https://www.poderjudicial.es/search/")).toBe(
      "https://www.poderjudicial.es/search/",
    );
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("extrae título, URL decodificada y snippet de los tres resultados", () => {
    const hits = parseDuckDuckGoHtml(ddgHtml);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      title: "Código Civil - Artículo 1968 - BOE.es",
      url: "https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763&p=20230629&tn=1#art1968",
    });
    expect(hits[0]?.snippet).toContain("Prescriben por el transcurso de un año");
    expect(hits[1]?.url).toBe("https://www.poderjudicial.es/search/AN/openDocument/1a2b3c4d5e6f");
    expect(hits[1]?.title).toContain("STS 1234/2023");
    expect(hits[2]?.url).toBe("https://www.ejemplo-juridico.es/blog/prescripcion-1902-cc?utm_source=ddg");
    expect(hits[2]?.snippet).toContain("interrupción por reclamación extrajudicial");
  });

  it("devuelve vacío si no hay resultados", () => {
    expect(parseDuckDuckGoHtml("<html><body><p>Nada</p></body></html>")).toEqual([]);
  });
});

describe("duckduckgoProvider.search", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("añade operadores site: y respeta maxResults", async () => {
    const fetchMock = vi.fn(
      async () => new Response(ddgHtml, { status: 200, headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const hits = await duckduckgoProvider.search("prescripción 1902", {
      maxResults: 2,
      domains: ["boe.es", "poderjudicial.es"],
    });
    expect(hits).toHaveLength(2);
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    const q = new URL(calledUrl).searchParams.get("q");
    expect(q).toContain("prescripción 1902");
    expect(q).toContain("site:boe.es");
    expect(q).toContain("site:poderjudicial.es");
  });

  it("falla con mensaje legible si DDG responde error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503, statusText: "Service Unavailable" })),
    );
    await expect(duckduckgoProvider.search("x", { maxResults: 5 })).rejects.toThrow(
      /DuckDuckGo respondió 503/,
    );
  });
});

describe("resolveSearchProvider", () => {
  it("sin claves usa duckduckgo y marca fallback", () => {
    const r = resolveSearchProvider({});
    expect(r.provider.name).toBe("duckduckgo");
    expect(r.fallback).toBe(true);
  });

  it("elige la primera clave presente (tavily → brave → exa)", () => {
    expect(resolveSearchProvider({ BRAVE_API_KEY: "b", EXA_API_KEY: "e" }).provider.name).toBe("brave");
    expect(resolveSearchProvider({ TAVILY_API_KEY: "t", BRAVE_API_KEY: "b" }).provider.name).toBe("tavily");
    expect(resolveSearchProvider({ EXA_API_KEY: "e" }).provider.name).toBe("exa");
    expect(resolveSearchProvider({ EXA_API_KEY: "e" }).fallback).toBe(false);
  });

  it("respeta LETRADO_WEB_SEARCH cuando hay clave", () => {
    const r = resolveSearchProvider({ LETRADO_WEB_SEARCH: "exa", TAVILY_API_KEY: "t", EXA_API_KEY: "e" });
    expect(r.provider.name).toBe("exa");
    expect(r.fallback).toBe(false);
  });

  it("avisa y cae a duckduckgo si LETRADO_WEB_SEARCH pide un proveedor sin clave", () => {
    const r = resolveSearchProvider({ LETRADO_WEB_SEARCH: "brave" });
    expect(r.provider.name).toBe("duckduckgo");
    expect(r.fallback).toBe(true);
    expect(r.warning).toMatch(/BRAVE_API_KEY/);
  });

  it("avisa ante un proveedor desconocido", () => {
    const r = resolveSearchProvider({ LETRADO_WEB_SEARCH: "google" });
    expect(r.provider.name).toBe("duckduckgo");
    expect(r.warning).toMatch(/desconocido/);
  });

  it("LETRADO_WEB_SEARCH=duckduckgo fuerza DDG aunque haya claves", () => {
    const r = resolveSearchProvider({ LETRADO_WEB_SEARCH: "duckduckgo", TAVILY_API_KEY: "t" });
    expect(r.provider.name).toBe("duckduckgo");
    expect(r.fallback).toBe(false);
  });
});

describe("formatSearchHits / DEFAULT_LEGAL_DOMAINS", () => {
  it("formatea resultados numerados con URL", () => {
    const text = formatSearchHits([
      { title: "T", url: "https://x.es", snippet: "S", published: "2024-01-01" },
    ]);
    expect(text).toContain("1. T");
    expect(text).toContain("URL: https://x.es");
    expect(text).toContain("Fecha: 2024-01-01");
    expect(formatSearchHits([])).toBe("Sin resultados.");
  });

  it("incluye los dominios oficiales previstos", () => {
    expect(DEFAULT_LEGAL_DOMAINS).toContain("boe.es");
    expect(DEFAULT_LEGAL_DOMAINS).toContain("poderjudicial.es");
    expect(DEFAULT_LEGAL_DOMAINS).toContain("eur-lex.europa.eu");
    expect(DEFAULT_LEGAL_DOMAINS).toHaveLength(8);
  });
});
