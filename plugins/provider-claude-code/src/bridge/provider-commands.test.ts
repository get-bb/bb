import { describe, expect, it } from "vitest";
import { toProviderCommandsState } from "./provider-commands.js";

describe("toProviderCommandsState", () => {
  it("leaves out the skills bb injected through its own plugins", () => {
    const state = toProviderCommandsState(
      [
        "bb-global-skills:bb-cli",
        "bb-global-skills-1a2b3c4d:secrets",
        "frontend-design:frontend-design",
        "simplify",
      ].map((name) => ({ name, description: "", argumentHint: "" })),
      new Set(),
    );

    expect(state.commands.map((command) => command.name)).toEqual([
      "frontend-design:frontend-design",
      "simplify",
    ]);
  });

  it("bounds descriptions, hints, and the payload size", () => {
    const state = toProviderCommandsState(
      Array.from({ length: 600 }, (_, index) => ({
        name: `skill-${index}`,
        description: "d".repeat(1_000),
        argumentHint: "h".repeat(1_000),
      })),
      new Set(),
    );

    expect(state.commands.length).toBeGreaterThan(0);
    expect(state.commands.length).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(
      60 * 1024,
    );
    expect(state.commands[0]?.description.length).toBe(300);
    expect(state.commands[0]?.inputHint?.length).toBe(200);
  });
});
