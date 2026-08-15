import { describe, expect, it } from "vitest";
import { buildPiCanonicalSessionParams } from "./session-params.js";

/**
 * Pi session parameter mapping. The shell-environment and thinking-level
 * cases moved here from the deleted legacy Pi adapter suite, which was the
 * only place asserting them.
 */

describe("buildPiCanonicalSessionParams", () => {
  it("injects the bb thread id into the shell env and drops invalid keys", () => {
    expect(
      buildPiCanonicalSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          envVars: {
            // Pi keys the policy by env-var name; a dotted key would nest and
            // silently become a different config path.
            "BAD.KEY": "ignored",
            TEST_VAR: "123",
          },
        },
      }).config,
    ).toEqual({
      "shell_environment_policy.set.BB_THREAD_ID": "bb-thread-1",
      "shell_environment_policy.set.TEST_VAR": "123",
    });
  });

  it("maps the bb reasoning ladder onto Pi thinking levels", () => {
    const params = (reasoningLevel: "none" | "high" | "ultracode") =>
      buildPiCanonicalSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: { reasoningLevel },
      });

    // bb's "none" is Pi's "off"; levels Pi has no name for are dropped rather
    // than sent as a value the bridge schema would reject.
    expect(params("none").reasoningLevel).toBe("off");
    expect(params("high").reasoningLevel).toBe("high");
    expect(params("ultracode")).not.toHaveProperty("reasoningLevel");
  });

  it("routes instructions by mode", () => {
    const withMode = (instructionMode: "append" | "replace") =>
      buildPiCanonicalSessionParams({
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
