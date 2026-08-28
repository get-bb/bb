import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const SHIPPED_SKILLS = [
  ["bb-cli", "apps/server/src/services/skills/builtin-skills/bb-cli"],
  [
    "bb-plugin-authoring",
    "apps/server/src/services/skills/builtin-skills/bb-plugin-authoring",
  ],
  [
    "skill-creator",
    "apps/server/src/services/skills/builtin-skills/skill-creator",
  ],
  [
    "submit-a-plugin",
    "apps/server/src/services/skills/builtin-skills/submit-a-plugin",
  ],
  ["automations", "plugins/automations/skills/automations"],
  ["share-server-links", "plugins/connect/skills/share-server-links"],
  ["docs", "plugins/docs/skills/docs"],
  ["inline-vis", "plugins/inline-vis/skills/inline-vis"],
  ["memory", "plugins/memory/skills/memory"],
  ["secrets", "plugins/secrets/skills/secrets"],
  ["tasks", "plugins/tasks/skills/tasks"],
  ["workflows", "plugins/workflows/skills/workflows"],
] as const;

function lineCount(text: string): number {
  return text.trimEnd().split("\n").length;
}

describe("shipped skills", () => {
  it.each(SHIPPED_SKILLS)(
    "%s uses concise frontmatter and one-level progressive disclosure",
    (expectedName, relativeRoot) => {
      const skillRoot = path.join(REPO_ROOT, relativeRoot);
      const skill = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
      const frontmatter = skill.match(
        /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/,
      );

      expect(frontmatter?.[1]).toBe(expectedName);
      expect(frontmatter?.[2]).toMatch(/\bUse\b/);
      expect(lineCount(skill)).toBeLessThanOrEqual(500);

      const referencesRoot = path.join(skillRoot, "references");
      const referenceFiles = existsSync(referencesRoot)
        ? readdirSync(referencesRoot, { withFileTypes: true })
        : [];
      expect(referenceFiles.every((entry) => entry.isFile())).toBe(true);

      const routedReferences = new Set(
        [...skill.matchAll(/references\/([a-z0-9][a-z0-9-]*\.md)/g)].map(
          (match) => match[1],
        ),
      );
      expect(routedReferences).toEqual(
        new Set(referenceFiles.map((entry) => entry.name)),
      );

      for (const reference of referenceFiles) {
        const content = readFileSync(
          path.join(referencesRoot, reference.name),
          "utf8",
        );
        expect(lineCount(content)).toBeLessThanOrEqual(500);
      }
    },
  );
});
