import { describe, expect, it, vi } from "vitest";
import {
  createClaudeCodeBridgeCommandListMemo,
  toProviderCommandsState,
} from "./provider-commands.js";

describe("toProviderCommandsState", () => {
  it("hides bb-managed, terminal-only, internal, and bb-injected commands", () => {
    const state = toProviderCommandsState(
      [
        "model",
        "doctor",
        "__remote-workflow",
        "bb-global-skills:bb-cli",
        "bb-global-skills-1a2b3c4d:secrets",
        "frontend-design:frontend-design",
        "simplify",
        "init",
      ].map((name) => ({ name, description: "", argumentHint: "" })),
    );

    expect(state.commands.map((command) => command.name)).toEqual([
      "frontend-design:frontend-design",
      "simplify",
      "init",
    ]);
  });

  it("drops malformed entries Claude Code reports", () => {
    expect(
      toProviderCommandsState([
        { description: "no name" },
        { name: "loop", description: 4, argumentHint: null },
        "simplify",
      ]),
    ).toEqual({ commands: [{ name: "loop", description: "" }] });
    expect(toProviderCommandsState({ commands: [] })).toEqual({ commands: [] });
  });

  it("bounds descriptions, hints, and the payload size", () => {
    const state = toProviderCommandsState(
      Array.from({ length: 600 }, (_, index) => ({
        name: `skill-${index}`,
        description: "d".repeat(1_000),
        argumentHint: "h".repeat(1_000),
      })),
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

describe("createClaudeCodeBridgeCommandListMemo", () => {
  it("caches each folder separately and retries after a failure", async () => {
    const list = vi
      .fn<
        (
          cwd: string,
        ) => Promise<{ commands: { name: string; description: string }[] }>
      >()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockImplementation(async (cwd) => ({
        commands: [{ name: cwd, description: "" }],
      }));
    const memo = createClaudeCodeBridgeCommandListMemo({
      list,
      now: () => 0,
      ttlMs: 1_000,
    });

    await expect(memo("/a")).rejects.toThrow("probe failed");
    await expect(memo("/a")).resolves.toEqual({
      commands: [{ name: "/a", description: "" }],
    });
    await memo("/a");
    await expect(memo("/b")).resolves.toEqual({
      commands: [{ name: "/b", description: "" }],
    });
    expect(list.mock.calls.map(([cwd]) => cwd)).toEqual(["/a", "/a", "/b"]);
  });
});
