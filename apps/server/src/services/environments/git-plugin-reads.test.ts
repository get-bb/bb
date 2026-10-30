import { describe, expect, it } from "vitest";
import { readCommitInputs, type GitPluginRpc } from "./git-plugin-reads.js";

function pluginsWith(
  lookup: ReturnType<GitPluginRpc["getRpcHandler"]>,
): GitPluginRpc {
  return {
    getRpcHandler: () => lookup,
    invokeRpcHandler: async () => {
      throw new Error("not called");
    },
  };
}

const ARGS = {
  environmentId: "env-1",
  workspacePath: "/work/env-1",
  maxDiffBytes: 1_000,
  maxFileListBytes: 1_000,
};

describe("readCommitInputs", () => {
  it("asks to turn the Git plugin on only when it is off", async () => {
    await expect(
      readCommitInputs(
        pluginsWith({ outcome: "not-running", status: "disabled", detail: null }),
        ARGS,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "git_plugin_unavailable",
        message: "Turn on the Git plugin to read this environment's changes",
      },
    });
    await expect(
      readCommitInputs(
        pluginsWith({
          outcome: "not-running",
          status: "error",
          detail: "server.js threw",
        }),
        ARGS,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "git_plugin_unavailable",
        message:
          "The Git plugin is failing to load (server.js threw). Reload it in Settings → Plugins to read this environment's changes",
      },
    });
  });
});
