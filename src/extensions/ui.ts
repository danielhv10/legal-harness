import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
