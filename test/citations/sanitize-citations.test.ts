import { describe, expect, it } from "vitest";

import { extractAllowedCitations, sanitizeCitations } from "../../src/lib/citations/sanitize-citations.js";

const CONTEXT = `Leyes Aplicables:
- Enlace: [Artículo 6 de la Ley 35/2006](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a6) (fecha: 2006-11-29)
  Ubicacion: Título I

Jurisprudencia CENDOJ:
- Enlace: [Tribunal Supremo, sentencia de 2025-05-01 (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286)](https://visor.example.org/search?id=C1&type=cendoj) (fecha: 2025-05-01)
  Ubicacion: Sala de lo Civil

Jurisprudencia relacionada con el caso:
- Enlace: [Audiencia Provincial de Barcelona, sentencia de 2019-07-23](http://localhost:3000/search?id=2528980&type=jurisprudencias) (fecha: 2019-07-23)
  Ubicacion: Sala Civil`;

describe("extractAllowedCitations", () => {
  it("collects URLs from served Markdown links (keeping query and anchor)", () => {
    const { urls } = extractAllowedCitations(CONTEXT);
    expect(urls.has("https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a6")).toBe(true);
    expect(urls.has("https://visor.example.org/search?id=C1&type=cendoj")).toBe(true);
    expect(urls.size).toBe(3);
  });

  it("collects Roj and ECLI identifiers present in context", () => {
    const { rojs, eclis } = extractAllowedCitations(CONTEXT);
    expect(rojs.has("STS 5286:2025")).toBe(true);
    expect(eclis.has("ES:TS:2025:5286")).toBe(true);
  });

  it("maps an internal viewer URL (/search?id=) to its exact served label", () => {
    const { internalLabels } = extractAllowedCitations(CONTEXT);
    expect(internalLabels.get("http://localhost:3000/search?id=2528980&type=jurisprudencias")).toBe(
      "Audiencia Provincial de Barcelona, sentencia de 2019-07-23",
    );
  });

  it("collects the numeric internal DB id from a /search?id= URL", () => {
    const { internalIds } = extractAllowedCitations(CONTEXT);
    expect(internalIds.has("2528980")).toBe(true);
  });

  it("does not treat a non-numeric /search?id= (e.g. CENDOJ) as an internal DB id", () => {
    const { internalIds } = extractAllowedCitations(CONTEXT);
    expect(internalIds.has("C1")).toBe(false);
  });
});

describe("sanitizeCitations", () => {
  const allowed = extractAllowedCitations(CONTEXT);

  it("keeps a link whose exact URL was served", () => {
    const text = "Ver [Artículo 6](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a6).";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("collapses a link with a fabricated URL to its plain label", () => {
    const text =
      "Ver [Sentencia de 12 de febrero de 2019](https://www.boe.es/buscar/doc.php?id=BOE-A-2022-4816).";
    expect(sanitizeCitations(text, allowed)).toBe("Ver Sentencia de 12 de febrero de 2019.");
  });

  it("collapses a link when the anchor was mutated (act.php but different anchor)", () => {
    const text = "[Artículo 6](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#aUnico)";
    expect(sanitizeCitations(text, allowed)).toBe("Artículo 6");
  });

  it("collapses a link whose URL was mutated with a whitespace in the anchor", () => {
    // The model sometimes injects a stray space into the served anchor
    // (`#a6` -> `#a a6`). A no-whitespace URL matcher would fail to match the
    // whole `[label](url)` construct and leave the broken link untouched.
    const text = "Ver [Artículo 6](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a a6).";
    expect(sanitizeCitations(text, allowed)).toBe("Ver Artículo 6.");
  });

  it("removes a fabricated ECLI and cleans the dangling separator", () => {
    const text = "El TS (Roj: STS 5286:2025 · ECLI: ES:TS:9999:1234) resolvió.";
    expect(sanitizeCitations(text, allowed)).toBe("El TS (Roj: STS 5286:2025) resolvió.");
  });

  it("removes a fabricated Roj and cleans the dangling separator", () => {
    const text = "El TS (Roj: STS 0000:2000 · ECLI: ES:TS:2025:5286) resolvió.";
    expect(sanitizeCitations(text, allowed)).toBe("El TS (ECLI: ES:TS:2025:5286) resolvió.");
  });

  it("removes the whole parenthesis when both identifiers are fabricated", () => {
    const text = "El TS (Roj: STS 0000:2000 · ECLI: ES:TS:9999:1234) resolvió.";
    expect(sanitizeCitations(text, allowed)).toBe("El TS resolvió.");
  });

  it("keeps genuine Roj and ECLI identifiers untouched", () => {
    const text = "El TS (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286) resolvió.";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("leaves plain text with no citations unchanged", () => {
    const text = "Un párrafo normal sin enlaces ni identificadores.";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });
});

// QR-284: real bug observed in production. A jurisprudencias row with no
// Roj/ECLI (roj/ecli null in Qdrant) was served with only tribunal+date as
// its label. The model kept the served (valid) URL but rewrote the label
// into a fabricated identifier built from the internal Supabase id visible
// in that same URL's query string — e.g. "SAP B 2528980:2019", where
// 2528980 is a database row id, not a real Roj.
describe("sanitizeCitations — internal id fabrication guard (QR-284)", () => {
  const allowed = extractAllowedCitations(CONTEXT);

  it("fixes a mutated label built from the internal DB id, reproducing the real bug", () => {
    const text =
      "Según el [SAP B 2528980:2019](http://localhost:3000/search?id=2528980&type=jurisprudencias), procede la nulidad.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Según el [Audiencia Provincial de Barcelona, sentencia de 2019-07-23](http://localhost:3000/search?id=2528980&type=jurisprudencias), procede la nulidad.",
    );
  });

  it("strips a fabricated identifier built from an internal id in prose, no link involved", () => {
    const text = "La sentencia SAP B 2528980:2019 establece que procede.";
    expect(sanitizeCitations(text, allowed)).toBe("La sentencia establece que procede.");
  });

  it("strips a bare internal-id:year token with no letter prefix", () => {
    const text = "Ver 2528980:2019 para más detalle.";
    expect(sanitizeCitations(text, allowed)).toBe("Ver para más detalle.");
  });

  it("does not touch a legitimate Roj served in context, even inside a link label", () => {
    const text =
      "Según [Tribunal Supremo, sentencia de 2025-05-01 (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286)](https://visor.example.org/search?id=C1&type=cendoj).";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("does not touch a legitimate Roj-shaped token in prose unrelated to any served internal id", () => {
    const text = "Como recuerda la STS 669:2017, el criterio es...";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("does not corrupt a link cut mid-stream before the closing paren", () => {
    const text = "Según el [SAP B 2528980:2019](http://localhost:3000/search?id=2528980&type=jurispr";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("does not corrupt a link cut mid-stream before the closing bracket", () => {
    const text = "Según el [SAP B 2528980:2019";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });
});

// QR-284: the model sometimes cites jurisprudencia using the bare Roj code
// lifted from the `Metadatos:` line (e.g. "STSJ M 15669:2025") instead of the
// qualified form served in the `Enlace:` label ("Roj: STSJ M 15669:2025 ·
// ECLI: ES:TSJM:2025:15669"). Deterministically qualify whitelisted bare
// codes instead of relying on a prompt rule.
describe("sanitizeCitations — Roj/ECLI qualification (QR-284)", () => {
  // A dedicated context (not the shared CONTEXT above, to avoid perturbing
  // its size/membership assertions): one label pairs a Roj with an ECLI, the
  // other has a Roj with no ECLI in the same label (so it must NOT be paired).
  const QUALIFY_CONTEXT = `Jurisprudencia CENDOJ:
- Enlace: [Tribunal Supremo, sentencia de 2025-05-01 (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286)](https://visor.example.org/search?id=C1&type=cendoj) (fecha: 2025-05-01)
  Ubicacion: Sala de lo Civil

Resoluciones y Consultas Vinculantes:
- Enlace: [Tribunal Superior de Justicia de Madrid, sentencia de 2025-03-10 (Roj: STSJ M 15669:2025)](https://visor.example.org/search?id=T1&type=jurisprudencias) (fecha: 2025-03-10)
  Ubicacion: Sala de lo Social`;
  const allowed = extractAllowedCitations(QUALIFY_CONTEXT);

  it('qualifies a bare whitelisted Roj into "Roj: X · ECLI: Y" when the paired ECLI is absent from the text', () => {
    const text = "Como recuerda STS 5286:2025, el criterio es claro.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Como recuerda Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286, el criterio es claro.",
    );
  });

  it('qualifies a bare whitelisted Roj with only "Roj: " when its paired ECLI already appears in the text', () => {
    const text = "Como recuerda STS 5286:2025, con ECLI: ES:TS:2025:5286, el criterio es claro.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Como recuerda Roj: STS 5286:2025, con ECLI: ES:TS:2025:5286, el criterio es claro.",
    );
  });

  it('qualifies a bare whitelisted Roj with no paired ECLI using only "Roj: "', () => {
    const text = "Según STSJ M 15669:2025, procede la nulidad.";
    expect(sanitizeCitations(text, allowed)).toBe("Según Roj: STSJ M 15669:2025, procede la nulidad.");
  });

  it('qualifies a bare whitelisted ECLI with "ECLI: " (never expands to its Roj)', () => {
    const text = "La resolución ES:TS:2025:5286 confirma el criterio.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "La resolución ECLI: ES:TS:2025:5286 confirma el criterio.",
    );
  });

  it("leaves an already-qualified code untouched (idempotent — twice equals once)", () => {
    const text = "Como recuerda Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286, el criterio es claro.";
    const once = sanitizeCitations(text, allowed);
    expect(once).toBe(text);
    expect(sanitizeCitations(once, allowed)).toBe(once);
  });

  it("does not qualify a bare Roj that is not whitelisted", () => {
    const text = "La STS 0000:2030 desconocida no aplica.";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("never qualifies a whitelisted Roj sitting inside a complete Markdown link label", () => {
    // Label matches EXACTLY what's served for this URL, so the pre-existing
    // label-restoration step (step 1) is a no-op here and this test isolates
    // the qualification step's own behavior on link content.
    const text =
      "Según [Tribunal Supremo, sentencia de 2025-05-01 (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286)](https://visor.example.org/search?id=C1&type=cendoj).";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("never qualifies a bare Roj inside a link cut mid-stream (no closing paren)", () => {
    const text =
      "Según el [Tribunal Superior de Justicia de Madrid (Roj: STSJ M 15669:2025)](https://visor.example.org/search?id=T1&type=jurispr";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("never qualifies a bare Roj inside a link cut mid-stream (label not yet closed)", () => {
    const text = "Según el [Tribunal Superior... STSJ M 15669:2025";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });
});

describe("extractAllowedCitations — Roj/ECLI pairing (QR-284)", () => {
  const QUALIFY_CONTEXT = `Jurisprudencia CENDOJ:
- Enlace: [Tribunal Supremo, sentencia de 2025-05-01 (Roj: STS 5286:2025 · ECLI: ES:TS:2025:5286)](https://visor.example.org/search?id=C1&type=cendoj) (fecha: 2025-05-01)
  Ubicacion: Sala de lo Civil

Resoluciones y Consultas Vinculantes:
- Enlace: [Tribunal Superior de Justicia de Madrid, sentencia de 2025-03-10 (Roj: STSJ M 15669:2025)](https://visor.example.org/search?id=T1&type=jurisprudencias) (fecha: 2025-03-10)
  Ubicacion: Sala de lo Social`;

  it("pairs a Roj with the ECLI present in the SAME served link label", () => {
    const { rojToEcli } = extractAllowedCitations(QUALIFY_CONTEXT);
    expect(rojToEcli.get("STS 5286:2025")).toBe("ES:TS:2025:5286");
  });

  it("does not pair a Roj with an ECLI from a DIFFERENT label (no cross-label co-occurrence)", () => {
    const { rojToEcli } = extractAllowedCitations(QUALIFY_CONTEXT);
    expect(rojToEcli.has("STSJ M 15669:2025")).toBe(false);
  });
});

// QR-284 amendment: autonomous TSJ courts use 6-7 letter org codes in their
// ECLI (TSJAND, TSJCLM, TSJGAL, ...), e.g. real production ECLI
// "ES:TSJAND:2025:16551". The org-code group was previously capped at
// {1,5} letters (fitting only "TS", "AN", etc.), making these ECLIs
// invisible to the sanitizer: never whitelisted, never paired, never
// qualified if cited bare.
describe("sanitizeCitations — long ECLI org codes (TSJ autonómicos, QR-284)", () => {
  const LONG_ECLI_CONTEXT = `Jurisprudencia CENDOJ:
- Enlace: [Tribunal Superior de Justicia de Andalucía, sentencia de 2025-06-01 (Roj: STSJ AND 16551:2025 · ECLI: ES:TSJAND:2025:16551)](https://visor.example.org/search?id=C2&type=cendoj) (fecha: 2025-06-01)
  Ubicacion: Sala de lo Social`;
  const allowed = extractAllowedCitations(LONG_ECLI_CONTEXT);

  it("extractAllowedCitations whitelists a 7-letter-org-code ECLI and pairs it with its Roj", () => {
    expect(allowed.eclis.has("ES:TSJAND:2025:16551")).toBe(true);
    expect(allowed.rojToEcli.get("STSJ AND 16551:2025")).toBe("ES:TSJAND:2025:16551");
  });

  it('expands a bare Roj into "Roj: X · ECLI: Y" when Y has a long org code', () => {
    const text = "Según STSJ AND 16551:2025, procede la nulidad.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Según Roj: STSJ AND 16551:2025 · ECLI: ES:TSJAND:2025:16551, procede la nulidad.",
    );
  });

  it('qualifies a bare ECLI with a long org code using "ECLI: "', () => {
    const text = "La resolución ES:TSJAND:2025:16551 confirma el criterio.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "La resolución ECLI: ES:TSJAND:2025:16551 confirma el criterio.",
    );
  });

  it("still strips a fabricated ECLI with a 6-letter org code that was not served", () => {
    const text = "El TS (ECLI: ES:XXXXXX:2030:99999) resolvió.";
    expect(sanitizeCitations(text, allowed)).toBe("El TS resolvió.");
  });
});

// QA bug: the model cites the modifying norm from the Vigencia line as bare
// text ("modificado el 2021-04-13 por BOE-A-2021-5773") — either it
// paraphrased the served Markdown link away, or it emitted a mutated URL the
// link-collapse step degraded to plain text. Both shapes are repaired by
// re-linking the id to the URL genuinely served for it.
describe("sanitizeCitations — BOE id re-linking", () => {
  const BOE_CONTEXT = `Leyes Aplicables:
- Enlace: [Real Decreto Legislativo 1/2010 (LSC)](https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544#a225) (fecha: 2010-07-02)
  Ubicacion: Título VI
  Vigencia: Documento: vigente · Artículo: modificado — modificado el 2021-04-13 por [BOE-A-2021-5773](https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773)`;
  const allowed = extractAllowedCitations(BOE_CONTEXT);

  it("extractAllowedCitations maps each served BOE id to its served URL", () => {
    expect(allowed.boeUrls.get("BOE-A-2021-5773")).toBe(
      "https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773",
    );
    expect(allowed.boeUrls.get("BOE-A-2010-10544")).toBe(
      "https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544#a225",
    );
  });

  it("prefers the anchor-less norm-level URL when both shapes were served for the same id", () => {
    const ctx = `- Enlace: [LSC](https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544#a225)
  Vigencia: ver [BOE-A-2010-10544](https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544)`;
    const { boeUrls } = extractAllowedCitations(ctx);
    expect(boeUrls.get("BOE-A-2010-10544")).toBe("https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544");
  });

  it("wraps a bare served BOE id in prose with its served URL (the reported bug)", () => {
    const text = "Art. 225 (vigente, modificado el 2021-04-13 por BOE-A-2021-5773): deber de diligencia.";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Art. 225 (vigente, modificado el 2021-04-13 por [BOE-A-2021-5773](https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773)): deber de diligencia.",
    );
  });

  it("re-links a BOE-id-labeled link whose URL the model mutated (act.php -> doc.php)", () => {
    const text = "Modificado por [BOE-A-2021-5773](https://www.boe.es/buscar/doc.php?id=BOE-A-2021-5773).";
    expect(sanitizeCitations(text, allowed)).toBe(
      "Modificado por [BOE-A-2021-5773](https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773).",
    );
  });

  it("leaves a bare BOE id untouched when no URL was served for it", () => {
    const text = "Modificado por BOE-A-1999-1234.";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("still collapses a fabricated link whose label is an unserved BOE id", () => {
    const text = "Ver [BOE-A-1999-1234](https://www.boe.es/buscar/act.php?id=BOE-A-1999-9999).";
    expect(sanitizeCitations(text, allowed)).toBe("Ver BOE-A-1999-1234.");
  });

  it("is idempotent: a correctly linked served id is untouched (twice equals once)", () => {
    const text = "Modificado por [BOE-A-2021-5773](https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773).";
    const once = sanitizeCitations(text, allowed);
    expect(once).toBe(text);
    expect(sanitizeCitations(once, allowed)).toBe(once);
  });

  it("never wraps a BOE id sitting inside a bare (non-Markdown) URL in prose", () => {
    const text = "Consulta https://www.boe.es/buscar/act.php?id=BOE-A-2021-5773 para el texto.";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });

  it("never wraps a BOE id inside a link cut mid-stream", () => {
    const text = "Modificado por [BOE-A-2021-5773](https://www.boe.es/busc";
    expect(sanitizeCitations(text, allowed)).toBe(text);
  });
});
