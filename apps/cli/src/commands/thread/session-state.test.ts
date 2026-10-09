import { describe, expect, it } from "vitest";
import {
  formatThreadProviderCommands,
  formatThreadSessionOptions,
  parseSessionOptionAssignments,
} from "./session-state.js";

describe("thread session state output", () => {
  it("lists agent commands with their argument hint and description", () => {
    expect(
      formatThreadProviderCommands([
        {
          name: "web",
          source: "command",
          origin: "builtin",
          description: "Search the web",
          argumentHint: "query",
        },
        {
          name: "compact",
          source: "command",
          origin: "builtin",
          description: null,
          argumentHint: null,
        },
      ]),
    ).toEqual(["/web <query>  Search the web", "/compact"]);
    expect(formatThreadProviderCommands(null)).toEqual([
      "The agent has not advertised any commands for this thread.",
    ]);
  });

  it("lists session options, marking the current value of a select", () => {
    expect(
      formatThreadSessionOptions([
        {
          type: "select",
          id: "mode",
          label: "Mode",
          description: null,
          category: "mode",
          value: "plan",
          pendingValue: "build",
          values: [
            { id: "plan", label: "Plan", description: null, group: null },
            { id: "build", label: "build", description: null, group: null },
          ],
        },
        {
          type: "boolean",
          id: "brave",
          label: "Brave mode",
          description: null,
          category: null,
          value: true,
          pendingValue: null,
        },
      ]),
    ).toEqual([
      "mode (Mode): plan -> build on the next turn",
      "  * plan  Plan",
      "    build",
      "brave (Brave mode): true",
    ]);
    expect(formatThreadSessionOptions([])).toEqual([
      "The agent has not reported any session options for this thread.",
    ]);
  });

  it("turns --set and --clear into a patch, reading true and false for a boolean option", () => {
    const options = [
      {
        type: "boolean" as const,
        id: "web",
        label: "Web search",
        description: null,
        category: null,
        value: false,
        pendingValue: null,
      },
    ];
    expect(
      parseSessionOptionAssignments({
        options,
        set: ["web=true", "mode=plan=strict"],
        clear: ["brave"],
      }),
    ).toEqual({ web: true, mode: "plan=strict", brave: null });
    expect(() =>
      parseSessionOptionAssignments({ options, set: ["web=yes"], clear: [] }),
    ).toThrow("takes true or false");
    expect(() =>
      parseSessionOptionAssignments({ options, set: ["=plan"], clear: [] }),
    ).toThrow("Expected <option-id>=<value>");
    expect(() =>
      parseSessionOptionAssignments({
        options,
        set: ["web=true"],
        clear: ["web"],
      }),
    ).toThrow("cannot be both set and cleared");
  });
});
