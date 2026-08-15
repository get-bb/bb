import { describe, expect, it } from "vitest";
import { buildPiSessionParams } from "./session-params.js";

/**
 * Pi session parameter mapping: the canonical wire options in, the pi bridge's
 * session-construction params out.
 */

describe("buildPiSessionParams", () => {
  it("injects the bb thread id into the shell env and drops invalid keys", () => {
    expect(
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          envVars: {
            // Pi applies these as its shell environment policy, which keys by
            // env-var name; a dotted key is not a name a shell can carry.
            "BAD.KEY": "ignored",
            TEST_VAR: "123",
          },
        },
      }).shellEnvOverrides,
    ).toEqual({
      BB_THREAD_ID: "bb-thread-1",
      TEST_VAR: "123",
    });
  });

  it("maps the bb reasoning ladder onto Pi thinking levels", () => {
    const params = (reasoningLevel: "none" | "high" | "ultracode") =>
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: { reasoningLevel },
      });

    // bb's "none" is Pi's "off"; levels Pi has no name for are dropped rather
    // than sent as a value the bridge schema would reject.
    expect(params("none").thinkingLevel).toBe("off");
    expect(params("high").thinkingLevel).toBe("high");
    expect(params("ultracode")).not.toHaveProperty("thinkingLevel");
  });

  it("routes instructions by mode", () => {
    const withMode = (instructionMode: "append" | "replace") =>
      buildPiSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode,
        options: { instructions: "  Focus on the failing tests first.  " },
      });

    expect(withMode("append")).toMatchObject({
      appendSystemPrompt: "Focus on the failing tests first.",
    });
    expect(withMode("append")).not.toHaveProperty("baseInstructions");
    expect(withMode("replace")).toMatchObject({
      baseInstructions: "Focus on the failing tests first.",
    });
    expect(withMode("replace")).not.toHaveProperty("appendSystemPrompt");
  });
});
