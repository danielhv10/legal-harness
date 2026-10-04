import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export { contextBar, contextLevel } from "../lib/ui-format.js";

/** Componente de texto de una o varias líneas, truncadas al ancho disponible. */
export function lines(build: (width: number) => string[]): {
  render(width: number): string[];
  invalidate(): void;
} {
  return {
    render(width: number) {
      return build(width).map((l) => truncateToWidth(l, width));
    },
    invalidate() {},
  };
}

export function textLine(_theme: Theme, parts: string[]): Text {
  return new Text(parts.join(" "), 0, 0);
}

/** Alinea izquierda/centro/derecha en una línea del ancho dado. */
export function threeColumns(width: number, left: string, center: string, right: string): string {
  const lw = visibleWidth(left);
  const cw = visibleWidth(center);
  const rw = visibleWidth(right);
  if (lw + cw + rw + 4 > width) {
    // Sin espacio: izquierda y derecha; centro se omite.
    const gap = Math.max(1, width - lw - rw);
    return lw + rw + 1 > width ? truncateToWidth(left, width) : `${left}${" ".repeat(gap)}${right}`;
  }
  const leftGap = Math.max(1, Math.floor((width - lw - cw - rw) / 2));
  const rightGap = Math.max(1, width - lw - cw - rw - leftGap);
  return `${left}${" ".repeat(leftGap)}${center}${" ".repeat(rightGap)}${right}`;
}

/**
 * Elige la primera variante de `candidates` que cabe junto a `left` (y `center` si se indica)
 * en el ancho dado. Si ninguna cabe devuelve la última (la más corta).
 */
export function pickFitting(width: number, left: string, center: string, candidates: string[]): string {
  const lw = visibleWidth(left);
  const cw = visibleWidth(center);
  for (const candidate of candidates) {
    const rw = visibleWidth(candidate);
    if (lw + rw + 1 <= width && (cw === 0 || lw + cw + rw + 4 <= width)) return candidate;
  }
  for (const candidate of candidates) {
    if (lw + visibleWidth(candidate) + 1 <= width) return candidate;
  }
  return candidates[candidates.length - 1] ?? "";
}

export interface BoxOptions {
  /** Ancho máximo del recuadro (incluidos los bordes). */
  maxWidth?: number;
  /** Color del borde (token del tema). */
  borderColor?: "border" | "borderAccent" | "borderMuted";
  /** Texto opcional incrustado en el borde superior, tras la esquina. */
  title?: string;
}

/**
 * Dibuja un recuadro `╭─╮│╰─╯` alrededor de las líneas dadas, truncándolas al interior.
 * Devuelve las líneas ya renderizadas (con ANSI) para usar en header/widgets.
 */
export function boxed(width: number, content: string[], theme: Theme, options: BoxOptions = {}): string[] {
  const color = options.borderColor ?? "border";
  const total = Math.max(8, Math.min(width, options.maxWidth ?? width));
  const inner = total - 4; // "│ " + " │"
  const border = (s: string) => theme.fg(color, s);
  const title = options.title ? truncateToWidth(options.title, Math.max(0, total - 6)) : "";
  const titleWidth = title ? visibleWidth(title) + 2 : 0;
  const top = title
    ? `${border("╭─")} ${title} ${border("─".repeat(Math.max(0, total - 4 - titleWidth)))}${border("╮")}`
    : border(`╭${"─".repeat(total - 2)}╮`);
  const bottom = border(`╰${"─".repeat(total - 2)}╯`);
  const rows = content.map((line) => {
    const clipped = truncateToWidth(line, inner);
    const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
    return `${border("│")} ${clipped}${pad} ${border("│")}`;
  });
  return [top, ...rows, bottom];
}

export function shortenPath(p: string, home = process.env.HOME ?? ""): string {
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatUsd(n: number): string {
  return n >= 1 ? `${n.toFixed(2)} $` : `${n.toFixed(3)} $`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
