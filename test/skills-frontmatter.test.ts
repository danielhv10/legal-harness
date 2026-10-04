import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const skillsDir = join(import.meta.dirname, "../resources/skills");
const promptsDir = join(import.meta.dirname, "../resources/prompts");

describe("frontmatter de skills y plantillas", () => {
  for (const name of readdirSync(skillsDir)) {
    it(`SKILL.md de ${name} se parsea con el parser de Pi`, () => {
      const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
      const { frontmatter } = parseFrontmatter<{ name?: string; description?: string }>(text);
      expect(frontmatter.name).toBe(name);
      expect(typeof frontmatter.description).toBe("string");
      expect((frontmatter.description ?? "").length).toBeGreaterThan(20);
    });
  }
  for (const file of readdirSync(promptsDir)) {
    it(`plantilla ${file} tiene description`, () => {
      const text = readFileSync(join(promptsDir, file), "utf8");
      const { frontmatter } = parseFrontmatter<{ description?: string }>(text);
      expect(typeof frontmatter.description).toBe("string");
    });
  }
});
