import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { withCreateAutomationPrompt } from "../composer.js";

describe("withCreateAutomationPrompt", () => {
  it("replaces a leading command, keeps later pills, and is idempotent", () => {
    const draft: ComposerDraftSnapshot = {
      text: "/plan check @spec daily",
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

    const next = withCreateAutomationPrompt(draft);

    expect(next.text).toBe("Create a new bb automation to check @spec daily");
    expect(next.mentions).toEqual([
      { kind: "project", projectId: "p", label: "spec", from: 36, to: 41 },
    ]);
    expect(withCreateAutomationPrompt({ ...draft, ...next })).toEqual(next);
  });
});
