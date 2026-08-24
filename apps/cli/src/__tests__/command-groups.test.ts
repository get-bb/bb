import { describe, expect, it } from "vitest";
import { Command } from "commander";
import {
  CORE_COMMAND_GROUPS,
  selectCommandGroups,
  type CommandGroupDeps,
} from "../command-groups.js";

const ALL_GROUP_NAMES = CORE_COMMAND_GROUPS.map((group) => group.name);

describe("selectCommandGroups", () => {
  it("needs no command group to answer --version", () => {
    expect(selectCommandGroups("--version")).toEqual([]);
    expect(selectCommandGroups("-V")).toEqual([]);
  });

  it("needs only the named group for a core command", () => {
    expect(selectCommandGroups("thread").map((group) => group.name)).toEqual([
      "thread",
    ]);
    expect(selectCommandGroups("status").map((group) => group.name)).toEqual([
      "status",
    ]);
  });

  it("needs every group, in help order, whenever commander shows the full program", () => {
    // No arguments and `help`/`--help` print the command list; an unknown or
    // plugin-contributed name falls through to commander's "unknown command"
    // suggestions. Both must see the same program a full registration builds.
    for (const firstArg of [undefined, "help", "--help", "-h", "linear"]) {
      expect(
        selectCommandGroups(firstArg).map((group) => group.name),
        `firstArg=${String(firstArg)}`,
      ).toEqual(ALL_GROUP_NAMES);
    }
  });
});

describe("CORE_COMMAND_GROUPS", () => {
  it("registers exactly the top-level commands it names, in order, with no aliases", async () => {
    // The static name table stands in for commander's command list before any
    // command module is loaded: it decides which group `bb <name>` loads and
    // which names the plugin proxy must leave alone. A group whose module
    // registers a different name, an extra top-level command, or an alias
    // would be a name commander accepts that the table does not know about.
    const program = new Command();
    const deps: CommandGroupDeps = {
      getUrl: () => "http://localhost",
      getContext: () => ({ serverUrl: "http://localhost" }),
    };
    for (const group of CORE_COMMAND_GROUPS) {
      const register = await group.load();
      register(program, deps);
    }
    expect(program.commands.map((command) => command.name())).toEqual(
      ALL_GROUP_NAMES,
    );
    expect(program.commands.flatMap((command) => command.aliases())).toEqual(
      [],
    );
    // Loading every group is the point of this guard, so it pays the import
    // cost of all 17 module graphs at once (`plugin` alone pulls the plugin
    // build toolchain and the scaffold templates). The shipped CLI never does
    // this; a contended CI runner needs more than the 5s default.
  }, 30_000);
});
