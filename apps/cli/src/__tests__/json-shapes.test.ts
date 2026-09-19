import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  CORE_COMMAND_GROUPS,
  type CommandGroupDeps,
} from "../command-groups.js";
import { resolveInvocation } from "../command-resolution.js";
import { JSON_SHAPE_BY_COMMAND_PATH } from "../json-shapes.js";

const JSON_GUIDE_PATH = fileURLToPath(
  new URL(
    "../../../../packages/templates/src/templates/bb-guide-json.md",
    import.meta.url,
  ),
);

describe("JSON shape help", () => {
  it("prints exactly the shape the json guide chapter documents", () => {
    const guide = readFileSync(JSON_GUIDE_PATH, "utf8");
    for (const [commandPath, shape] of Object.entries(
      JSON_SHAPE_BY_COMMAND_PATH,
    )) {
      expect(guide, commandPath).toContain(`\n    ${shape}\n`);
      expect(guide, commandPath).toMatch(
        new RegExp(`\\n  bb ${commandPath}[^\\n]* --json\\n`),
      );
    }
  });

  it("only names commands that exist and accept --json", async () => {
    const program = new Command();
    const deps: CommandGroupDeps = {
      getUrl: () => "http://localhost",
      getContext: () => ({ serverUrl: "http://localhost" }),
    };
    for (const group of CORE_COMMAND_GROUPS) {
      (await group.load())(program, deps);
    }
    for (const commandPath of Object.keys(JSON_SHAPE_BY_COMMAND_PATH)) {
      const invocation = resolveInvocation(program, [
        "node",
        "bb",
        ...commandPath.split(" "),
      ]);
      expect(invocation.path.join(" "), commandPath).toBe(commandPath);
      expect(
        invocation.command.options.some((option) => option.long === "--json"),
        commandPath,
      ).toBe(true);
    }
  }, 30_000);
});
