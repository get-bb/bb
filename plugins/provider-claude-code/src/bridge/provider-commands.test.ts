import { describe, expect, it } from "vitest";
import { toProviderCommandsState } from "./provider-commands.js";

describe("toProviderCommandsState", () => {
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
