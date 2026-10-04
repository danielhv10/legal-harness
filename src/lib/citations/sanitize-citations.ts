/**
 * Post-generation guardrail against fabricated citations.
 *
 * The answer model is served, per document, a single ready-to-copy Markdown
 * link in the `Enlace:` header plus (for jurisprudence/resolutions) Roj/ECLI
 * identifiers. Despite the prompt rules it occasionally (a) invents or mutates
 * a URL (e.g. `act.php` -> `doc.php`, dropping a `#…` anchor, or reusing one
 * document's id for a different source) or (b) fabricates a Roj/ECLI code.
 *
 * These functions cross-check the generated text against the exact strings that
 * were actually served (the system message that carries every content block).
 * Anything not present in that context is stripped:
 *   - a Markdown link with an unknown URL collapses to its plain label,
 *   - an unknown `Roj:`/`ECLI:` identifier is removed, with the surrounding
 *     separators/parentheses cleaned up.
 * One repair pass complements the stripping: a BOE identifier the model left
 * bare (or linked through a mutated URL) is re-linked to the URL genuinely
 * served for that id — see `boeUrls` below.
 *
 * This is a pure regex + set-membership pass (no LLM, no network); it runs in
 * microseconds and is safe to apply on every streamed update and at onFinish.
 */

export interface AllowedCitations {
  urls: Set<string>;
  rojs: Set<string>;
  eclis: Set<string>;
  // url -> exact label served for it, for internal citation-detail-view links
  // (any `/search?id=...` URL). Used to correct a label the model mutated
  // while keeping a URL that was genuinely served (see QR-284 below).
  internalLabels: Map<string, string>;
  // Numeric internal DB ids (the `id` query param) served this turn via a
  // `/search?id=<id>` link, e.g. "2528980" for a jurisprudencias/resoluciones
  // row with no Roj/ECLI. Non-numeric ids (e.g. CENDOJ's own id scheme) are
  // excluded — only numeric Supabase row ids are at risk of being mistaken
  // for a citation number.
  internalIds: Set<string>;
  // Roj -> ECLI pairing observed within the SAME served link label ([label]
  // (url)) — the only reliable pairing source; never inferred from
  // co-occurrence elsewhere in the context. Used to expand a whitelisted bare
  // Roj into "Roj: X · ECLI: Y" when the model cites the Roj without its
  // qualified ECLI (QR-284).
  rojToEcli: Map<string, string>;
  // BOE identifier (e.g. "BOE-A-2021-5773") -> a URL genuinely served for it
  // this turn (from an `Enlace:`/`Vigencia:` link). Used to REPAIR instead of
  // degrade: a bare BOE id in prose (the model paraphrased the Vigencia line
  // and dropped its Markdown link) gets wrapped with the served URL, and a
  // link whose URL the model mutated but whose label is a served BOE id gets
  // re-linked instead of collapsing to plain text. Anchor-less norm-level
  // URLs are preferred over article-anchored ones (`…#a6`).
  boeUrls: Map<string, string>;
}

// A served Markdown link: `[<label>](<url>)`. We anchor the URL group on the
// closing `)` of the link target so query strings and `#anchors` are kept
// intact and only whitespace/`)` terminate the match.
const CONTEXT_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

// The internal citation-detail-view route is `/search?id=<id>&type=<type>`.
// Matched non-globally and re-run per link URL (no shared `lastIndex` state).
const INTERNAL_VIEWER_ID_RE = /\/search\?id=([^&)\s]+)/;

// A BOE identifier inside a served boe.es URL (`…?id=BOE-A-2021-5773`).
// Matched non-globally and re-run per link URL.
const BOE_URL_ID_RE = /boe\.es\/[^\s)]*\bid=(BOE-A-\d{4}-\d+)/;

// ECLI: e.g. `ES:TS:2025:5286`, `ES:AN:2016:5124`, `ES:TSJAND:2025:16551`
// (autonomous TSJ courts use 6-7 letter org codes: TSJAND, TSJCLM, TSJGAL...).
const ECLI_RE = /ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?/g;

// Roj: e.g. `STS 5053:2025`, `SAP M 5887:2025`, `SAN 4809:2025`, `ATS 4392:2026A`.
// Two leading letter groups (the second optional, e.g. the `M` in `SAP M`),
// then `<number>:<year>` with an optional trailing letter.
//
// The number is deliberately capped at 6 digits: real Roj numbers fit in that
// range, while Supabase's internal row ids (the ones a model has fabricated a
// citation from, QR-284) run 7+ digits. That gap is what keeps this regex from
// ever whitelisting a fabricated Roj built from an internal id — it simply
// won't match one. The internal-id-in-prose guard in `sanitizeCitations`
// below doesn't rely on this digit cap either; it strips by exact match
// against ids extracted from served `/search?id=` URLs instead, which is
// robust even if a future id happens to be 6 digits or fewer.
const ROJ_RE = /[A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?/g;

/**
 * Collects every URL, Roj, ECLI and internal-viewer id/label literally
 * present in the served context so the sanitizer can whitelist them. Roj/ECLI
 * are matched anywhere in the text (they appear inside link labels and
 * metadata), URLs only inside link targets.
 */
export function extractAllowedCitations(context: string): AllowedCitations {
  const urls = new Set<string>();
  const internalLabels = new Map<string, string>();
  const internalIds = new Set<string>();
  const rojToEcli = new Map<string, string>();
  const boeUrls = new Map<string, string>();

  // Nota del port: `label`/`url` y los grupos de `exec` se tipan como `string`
  // (siempre existen: son grupos obligatorios) para `noUncheckedIndexedAccess`.
  Array.from(context.matchAll(CONTEXT_LINK_RE)).forEach(([, label = "", url = ""]) => {
    urls.add(url);

    const idMatch = INTERNAL_VIEWER_ID_RE.exec(url);
    if (idMatch) {
      const internalId = idMatch[1] as string;
      internalLabels.set(url, label);
      if (/^\d+$/.test(internalId)) {
        internalIds.add(internalId);
      }
    }

    // BOE id -> served URL, preferring the anchor-less norm-level URL (the
    // shape the Vigencia line serves) over an article-anchored one.
    const boeIdMatch = BOE_URL_ID_RE.exec(url);
    if (boeIdMatch) {
      const boeId = boeIdMatch[1] as string;
      const existing = boeUrls.get(boeId);
      if (!existing || (existing.includes("#") && !url.includes("#"))) {
        boeUrls.set(boeId, url);
      }
    }

    // Roj/ECLI pairing (QR-284): only trusted when both codes appear in this
    // SAME label — e.g. "Tribunal Supremo... (Roj: STS 5286:2025 · ECLI:
    // ES:TS:2025:5286)". Never inferred from co-occurrence across labels.
    const labelRoj = label.match(ROJ_RE)?.[0];
    const labelEcli = label.match(ECLI_RE)?.[0];
    if (labelRoj && labelEcli) {
      rojToEcli.set(labelRoj, labelEcli);
    }
  });

  const eclis = new Set<string>(Array.from(context.matchAll(ECLI_RE), (m) => m[0]));
  const rojs = new Set<string>(Array.from(context.matchAll(ROJ_RE), (m) => m[0]));

  return { urls, rojs, eclis, internalLabels, internalIds, rojToEcli, boeUrls };
}

/** Tidies separators/parentheses left dangling after removing an identifier. */
function cleanupDanglingSeparators(text: string): string {
  return (
    text
      // `( · ` -> `(`   and   ` · )` -> `)`  (identifier removed at an edge)
      .replace(/\(\s*·\s*/g, "(")
      .replace(/\s*·\s*\)/g, ")")
      // `A ·  · B` -> `A · B`  (identifier removed in the middle)
      .replace(/·\s*·/g, "·")
      // `()` / `( )` left after removing the only identifier
      .replace(/\(\s*\)/g, "")
      // collapse the double spaces the removals leave behind
      .replace(/ {2,}/g, " ")
      // no space before `,` `.` or `)` (but keep the spaces around `·`, a
      // separator that only stays when a valid identifier flanks it)
      .replace(/ +([,.)])/g, "$1")
      // no orphan space right after `(`
      .replace(/\( +/g, "(")
      .trimEnd()
  );
}

// Matches, at any position, either a fully-formed `[label](url)` link, a
// link cut mid-stream (label closed, url not yet closed by `)`), or a link
// cut mid-stream even earlier (label itself not yet closed by `]`). All three
// alternatives are left untouched (returned as-is) by the callback in
// `sanitizeCitations` step 1b below — they exist purely so that alternative 4
// (the internal-id-in-prose token) never fires INSIDE an in-progress or
// completed link, only in plain surrounding prose. Only alternative 4 has a
// capturing group, so `idDigits` is `undefined` whenever 1-3 matched instead.
const LINK_OR_PARTIAL_OR_ID_RE =
  /\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*$|\[[^\]]*$|(?:[A-Z]{2,5}(?: [A-Z0-9]{1,4})?\s+)?(\d+):\d{4}[A-Z]?/g;

/**
 * Step 1 of `sanitizeCitations` extracted as a standalone pure function so
 * it can be applied safely on stream prefixes (unlike the Roj/ECLI steps,
 * which can corrupt an identifier split at a chunk boundary).
 *
 * Collapses Markdown links whose URL was not served (fabricated / mutated) to
 * their plain label, and restores the served label for internal citation-detail-
 * view links whose label the model mutated while keeping the URL intact (QR-284).
 *
 * Safe to run on incomplete text as long as only COMPLETE `[label](url)` tokens
 * are passed in — callers MUST buffer any trailing in-progress link construct
 * and only pass the safe prefix. See `createCitationStreamTransform` in
 * `sanitize-stream.ts` for the stream-side buffering logic.
 *
 * The URL group allows any char except `)` (including whitespace) on purpose:
 * the model sometimes MUTATES a served URL by injecting a space into the
 * anchor (e.g. `#art612` -> `#art art612`). A `[^)\s]+` matcher would fail to
 * match the whole `[label](url)` construct for such a link and leave the
 * broken URL untouched. Served URLs never contain spaces, so any whitespace
 * inside the parens means a mutation: it won't be in `allowed.urls` and the
 * link collapses to its plain label.
 */
export function collapseUnservedLinks(text: string, allowed: AllowedCitations): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, label: string, url: string) => {
    if (!allowed.urls.has(url)) {
      // Repair instead of degrade (QR bug: "modificado por BOE-A-… sin
      // enlace"): a link whose label is exactly a BOE id we served a URL
      // for gets re-linked to that served URL — the model mutated the URL
      // but the citation itself is genuine.
      const servedBoeUrl = allowed.boeUrls.get(label.trim());
      if (servedBoeUrl) {
        return `[${label.trim()}](${servedBoeUrl})`;
      }
      return label;
    }
    const servedLabel = allowed.internalLabels.get(url);
    return servedLabel && servedLabel !== label ? `[${servedLabel}](${url})` : match;
  });
}

/**
 * Strips citations the model produced that were not in the served context:
 *   - Markdown links whose URL is not whitelisted collapse to their label,
 *   - a link whose URL IS whitelisted but whose label was mutated into a
 *     fabricated identifier gets its label restored to the one served
 *     (internal citation-detail-view links only — QR-284),
 *   - a fabricated identifier built from an internal DB id in bare prose
 *     (no link) is removed outright (QR-284),
 *   - `Roj:`/`ECLI:` identifiers whose code is not whitelisted are removed.
 * Everything present in the context is preserved verbatim.
 */
export function sanitizeCitations(text: string, allowed: AllowedCitations): string {
  // 1) Markdown links: collapse non-whitelisted links and restore mutated
  // labels for served internal-viewer URLs. Delegated to `collapseUnservedLinks`
  // so the same logic can be applied on stream prefixes (see sanitize-stream.ts).
  let out = collapseUnservedLinks(text, allowed);

  // 1b) Fabricated identifier built from an internal DB id in bare prose (no
  // link at all — the link case is already handled by step 1 above). Skipped
  // entirely when no internal ids were served this turn, so a turn with no
  // internal-viewer citations pays nothing for this pass.
  if (allowed.internalIds.size > 0) {
    out = out.replace(LINK_OR_PARTIAL_OR_ID_RE, (match, idDigits?: string) =>
      idDigits !== undefined && allowed.internalIds.has(idDigits) ? "" : match,
    );
  }

  // 1c) Bare BOE identifiers in prose (QR bug: "modificado el … por
  // BOE-A-2021-5773" without a link). The Vigencia line serves each modifying
  // norm as a ready Markdown link, but the model sometimes paraphrases it and
  // drops the link. When a URL for that exact id was genuinely served this
  // turn, wrap the bare id with it; unknown ids are left untouched (this pass
  // can only reproduce served links, never mint one). The alternation matches
  // complete links, mid-stream partial links and bare URLs WHOLE so the bare
  // id (the only capturing alternative) never fires inside them — the same
  // atomic-alternation technique as LINK_OR_PARTIAL_OR_ID_RE — which also
  // makes the pass idempotent: once wrapped, the id sits inside a link.
  if (allowed.boeUrls.size > 0) {
    out = out.replace(
      /\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*$|\[[^\]]*$|https?:\/\/[^\s)]+|\b(BOE-A-\d{4}-\d+)/g,
      (match, boeId?: string) => {
        if (boeId === undefined) return match;
        const servedUrl = allowed.boeUrls.get(boeId);
        return servedUrl ? `[${boeId}](${servedUrl})` : match;
      },
    );
  }

  // 2) Fabricated ECLI identifiers (`ECLI: <code>`).
  out = out.replace(/ECLI:\s*(ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?)/g, (match, code: string) =>
    allowed.eclis.has(code) ? match : "",
  );

  // 3) Fabricated Roj identifiers (`Roj: <code>`).
  out = out.replace(/Roj:\s*([A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?)/g, (match, code: string) =>
    allowed.rojs.has(code) ? match : "",
  );

  // 4) Qualify legitimate Roj/ECLI codes the model wrote bare — no "Roj:"/
  // "ECLI:" prefix, typically lifted from a `Metadatos:` line instead of the
  // qualified `Enlace:` label (QR-284). Runs AFTER steps 2/3 above (which
  // strip FABRICATED *prefixed* identifiers) so it never re-qualifies
  // something they were about to remove.
  //
  // Same atomic-alternation technique as LINK_OR_PARTIAL_OR_ID_RE: a complete
  // link, a link cut mid-stream, and an already-qualified code are each
  // matched WHOLE (by an earlier, more specific alternative) and returned
  // untouched by the callback below — this pass only ever rewrites a bare
  // code sitting in plain prose, and re-running it on already-qualified text
  // is a no-op (idempotent).
  out = out.replace(
    /\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*$|\[[^\]]*$|Roj:\s*[A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?|ECLI:\s*ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?|[A-Z]{2,5}(?: [A-Z0-9]{1,4})? \d{1,6}:\d{4}[A-Z]?|ES:[A-Z]{1,7}:\d{4}:\d{1,6}[A-Z]?/g,
    (match) => {
      // Link, partial link, or already-qualified code: leave as-is.
      if (match.startsWith("[") || /^(Roj|ECLI):/.test(match)) return match;

      // Bare ECLI: qualify, never expand to its Roj (asymmetric by design —
      // the observed fabrication only ever strips the Roj's own prefix).
      if (match.startsWith("ES:")) {
        return allowed.eclis.has(match) ? `ECLI: ${match}` : match;
      }

      // Bare Roj: qualify, and expand with its paired ECLI (if any) unless
      // that ECLI is already present somewhere else in the response text.
      if (!allowed.rojs.has(match)) return match;
      const pairedEcli = allowed.rojToEcli.get(match);
      return pairedEcli && !out.includes(pairedEcli)
        ? `Roj: ${match} · ECLI: ${pairedEcli}`
        : `Roj: ${match}`;
    },
  );

  return cleanupDanglingSeparators(out);
}
