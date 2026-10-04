import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  emptyAllowed,
  extractSessionState,
  harvestFromToolResult,
  mergeAllowed,
  servedFromText,
  urlsFromWebFetch,
  urlsFromWebSearch,
} from "../../src/lib/citations/harvest.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEXT = readFileSync(join(here, "../fixtures/research-result.txt"), "utf8");
const STRUCTURED = JSON.parse(readFileSync(join(here, "../fixtures/research-structured.json"), "utf8"));

const textContent = [{ type: "text", text: TEXT }];

describe("harvestFromToolResult (texto de bloques)", () => {
  const { allowed, served } = harvestFromToolResult("mcp__fuentes__research", textContent, undefined);

  it("recoge las URLs de Enlace: y Vigencia:", () => {
    expect(allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404")).toBe(true);
    expect(allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a405")).toBe(true);
    expect(allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2015-10727")).toBe(true);
    expect(allowed.urls.has("https://visor.example.org/search?id=2528980&type=jurisprudencias")).toBe(true);
    expect(allowed.urls.size).toBe(4);
  });

  it("recoge Roj/ECLI aunque la cabecera no sea un enlace", () => {
    expect(allowed.rojs.has("STS 1234:2024")).toBe(true);
    expect(allowed.rojs.has("SAP M 5887:2023")).toBe(true);
    expect(allowed.eclis.has("ES:TS:2024:1234")).toBe(true);
  });

  it("mapea BOE-A → URL sin ancla e ids internos del visor", () => {
    expect(allowed.boeUrls.get("BOE-A-2015-10727")).toBe(
      "https://www.boe.es/buscar/act.php?id=BOE-A-2015-10727",
    );
    expect(allowed.boeUrls.get("BOE-A-2000-323")).toBe(
      "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404",
    );
    expect(allowed.internalIds.has("2528980")).toBe(true);
  });

  it("construye la lista legible por documento con fecha y vigencia", () => {
    expect(served).toHaveLength(5);
    expect(served[0]).toMatchObject({
      label: "Artículo 404 de la Ley 1/2000, de Enjuiciamiento Civil",
      url: "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404",
      date: "2000-01-08",
      source: "mcp",
    });
    expect(served[0]?.vigencia).toContain("modificado el 2015-10-06");
    expect(served[2]).toMatchObject({ roj: "STS 1234:2024", ecli: "ES:TS:2024:1234", date: "2024-03-12" });
    expect(served[2]?.url).toBeUndefined();
    expect(served[3]).toMatchObject({
      roj: "SAP M 5887:2023",
      url: "https://visor.example.org/search?id=2528980&type=jurisprudencias",
    });
    expect(served[4]?.label).toContain("Tribunal Económico-Administrativo Central");
  });

  it("servedFromText ignora líneas que no son cabeceras", () => {
    expect(servedFromText("Sin documentos.\n  Contenido: nada")).toEqual([]);
  });
});

describe("harvestFromToolResult (structuredContent)", () => {
  it("prefiere citations[] para la lista y une allowed_citations a la lista blanca", () => {
    const { allowed, served } = harvestFromToolResult("mcp__fuentes__research", [], STRUCTURED);
    expect(served).toHaveLength(3);
    expect(served[0]).toMatchObject({
      docKey: "boe:BOE-A-2000-323:a404",
      url: "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404",
    });
    expect(served[1]).toMatchObject({ roj: "STS 1234:2024", ecli: "ES:TS:2024:1234" });
    expect(served[1]?.url).toBeUndefined();
    expect(allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2015-10727")).toBe(true);
    expect(allowed.rojs.has("SAP M 5887:2023")).toBe(true);
    expect(allowed.eclis.has("ES:TS:2024:1234")).toBe(true);
    expect(allowed.rojToEcli.get("STS 1234:2024")).toBe("ES:TS:2024:1234");
    expect(allowed.internalIds.has("2528980")).toBe(true);
    expect(allowed.boeUrls.get("BOE-A-2000-323")).toBe(
      "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404",
    );
  });

  it("desenvuelve el CallToolResult con que Pi envuelve los resultados MCP", () => {
    const wrapped = {
      content: [{ type: "text", text: "digest" }],
      structuredContent: STRUCTURED,
      isError: false,
    };
    const { served } = harvestFromToolResult("mcp__fuentes__research", [], wrapped);
    expect(served).toHaveLength(3);
    expect(extractSessionState(wrapped)).toEqual(STRUCTURED.session_state);
  });

  it("combina texto y estructura: la lista blanca es la unión", () => {
    const { allowed, served } = harvestFromToolResult("mcp__fuentes__research", textContent, STRUCTURED);
    expect(served).toHaveLength(3); // estructurado manda
    expect(allowed.urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a405")).toBe(true); // solo en texto
  });

  it("extractSessionState devuelve undefined sin session_state", () => {
    expect(extractSessionState({ citations: [] })).toBeUndefined();
    expect(extractSessionState("texto")).toBeUndefined();
  });
});

describe("mergeAllowed / emptyAllowed", () => {
  it("une conjuntos y prefiere la URL BOE sin ancla", () => {
    const a = emptyAllowed();
    a.urls.add("https://a");
    a.boeUrls.set("BOE-A-2000-323", "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323#a404");
    const b = emptyAllowed();
    b.urls.add("https://b");
    b.rojs.add("STS 1:2024");
    b.boeUrls.set("BOE-A-2000-323", "https://www.boe.es/buscar/act.php?id=BOE-A-2000-323");
    const m = mergeAllowed(a, b);
    expect([...m.urls]).toEqual(["https://a", "https://b"]);
    expect(m.rojs.has("STS 1:2024")).toBe(true);
    expect(m.boeUrls.get("BOE-A-2000-323")).toBe("https://www.boe.es/buscar/act.php?id=BOE-A-2000-323");
    expect(a.urls.size).toBe(1); // no muta
  });
});

describe("urlsFromWebFetch / urlsFromWebSearch", () => {
  it("lee details.url y descarta valores no http", () => {
    expect(urlsFromWebFetch({ url: "https://www.boe.es/x" })).toEqual(["https://www.boe.es/x"]);
    expect(urlsFromWebFetch({ url: "file:///etc/passwd" })).toEqual([]);
    expect(urlsFromWebFetch(undefined)).toEqual([]);
  });

  it("lee details.hits[].url", () => {
    expect(
      urlsFromWebSearch({ hits: [{ url: "https://a" }, { url: "https://a" }, { title: "sin url" }] }),
    ).toEqual(["https://a"]);
    expect(urlsFromWebSearch({})).toEqual([]);
  });
});
