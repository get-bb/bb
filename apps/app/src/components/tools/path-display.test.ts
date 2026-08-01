import { describe, expect, it } from "vitest";
import { formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";

describe("formatHomePathForDisplay", () => {
  it.each([
    ["/Users/you", "~"],
    ["/Users/you/.bb/plugins/github", "~/.bb/plugins/github"],
    ["/home/u/.bb/skills/review", "~/.bb/skills/review"],
    ["/root/.bb/automations/run.sh", "~/.bb/automations/run.sh"],
    ["C:\\Users\\you\\.bb\\plugins", "~\\.bb\\plugins"],
  ])("compacts a conventional home path %s", (path, expected) => {
    expect(formatHomePathForDisplay(path)).toBe(expected);
  });

  it.each([
    "/managed/plugins/github",
    "/Volumes/work/plugins/github",
    "skills.sh/example/writing-voice",
    "SKILL.md",
  ])("preserves a path outside a conventional home %s", (path) => {
    expect(formatHomePathForDisplay(path)).toBe(path);
  });
});
