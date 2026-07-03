import { describe, expect, it } from "vitest";
import { filterPluginCommandSuggestions } from "./plugin-command-suggestions";

const COMMANDS = [
  { pluginId: "linear", name: "standup", description: "Draft a standup" },
  { pluginId: "linear", name: "triage", description: "Sort standing issues" },
  { pluginId: "notes", name: "note", description: "Capture a quick note" },
];

describe("filterPluginCommandSuggestions", () => {
  it("returns every command as a plugin-command suggestion for an empty query", () => {
    const suggestions = filterPluginCommandSuggestions(COMMANDS, "");
    expect(suggestions.map((s) => s.name)).toEqual([
      "note",
      "standup",
      "triage",
    ]);
    expect(suggestions[0]).toEqual({
      kind: "plugin-command",
      pluginId: "notes",
      name: "note",
      description: "Capture a quick note",
    });
  });

  it("matches case-insensitively on name or description, name prefixes first", () => {
    // "stand" prefixes "standup" and substring-matches triage's description.
    expect(
      filterPluginCommandSuggestions(COMMANDS, "STAND").map((s) => s.name),
    ).toEqual(["standup", "triage"]);
  });

  it("drops commands that match neither name nor description", () => {
    expect(filterPluginCommandSuggestions(COMMANDS, "deploy")).toEqual([]);
  });
});
