import { describe, expect, it } from "vitest";
import { pickWordmarkScale, wordmarkLines, wordmarkWidth } from "../src/lib/wordmark.js";

describe("wordmark", () => {
  it("tiene 5 filas y el ancho esperado", () => {
    const lines = wordmarkLines();
    expect(lines).toHaveLength(5);
    expect(Math.max(...lines.map((l) => l.length))).toBe(wordmarkWidth());
    expect(wordmarkWidth()).toBe(7 * 5 + 6);
  });
  it("la escala 2 duplica cada columna", () => {
    const l1 = wordmarkLines("LE", 1);
    const l2 = wordmarkLines("LE", 2);
    expect(l2[4]).toBe("██████████  ██████████");
    expect(l1[4]).toBe("█████ █████");
  });
  it("elige la escala según el ancho", () => {
    expect(pickWordmarkScale(120)).toBe(2);
    expect(pickWordmarkScale(60)).toBe(1);
    expect(pickWordmarkScale(30)).toBeNull();
  });
  it("dibuja la L y la O reconocibles", () => {
    const [top, , , , bottom] = wordmarkLines("L");
    expect(top).toBe("█");
    expect(bottom).toBe("█████");
    expect(wordmarkLines("O")[0]).toBe(" ███");
  });
});
