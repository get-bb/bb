import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { withCreatePluginPrompt } from "./app.js";

describe("withCreatePluginPrompt", () => {
  it("replaces a leading command, keeps later pills, and is idempotent", () => {
    const draft: ComposerDraftSnapshot = {
      text: "/plan wraps @spec",
      mentions: [
        {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          argumentHint: null,
          label: "plan",
          from: 0,
          to: 5,
        },
        { kind: "project", projectId: "p", label: "spec", from: 12, to: 17 },
      ],
      attachments: [],
    };

    const next = withCreatePluginPrompt(draft);

    expect(next.text).toBe("Create a new bb plugin that wraps @spec");
    expect(next.mentions).toEqual([
      { kind: "project", projectId: "p", label: "spec", from: 34, to: 39 },
    ]);
    expect(withCreatePluginPrompt({ ...draft, ...next })).toEqual(next);
  });
});
