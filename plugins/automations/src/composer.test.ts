import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { withAutomationCommand } from "../composer.js";

const planPill = {
  kind: "command",
  trigger: "/",
  name: "plan",
  source: "command",
  origin: "user",
  argumentHint: null,
  label: "plan",
} as const;

describe("withAutomationCommand", () => {
  it("replaces a leading command and keeps later pills on their text", () => {
    const draft: ComposerDraftSnapshot = {
      text: "/plan check @spec daily",
      mentions: [
        { ...planPill, from: 0, to: 5 },
        { kind: "project", projectId: "p", label: "spec", from: 12, to: 17 },
      ],
      attachments: [],
    };

    const next = withAutomationCommand(draft);

    expect(next.text).toBe("/automation check @spec daily");
    expect(next.mentions.map(({ kind, from, to }) => [kind, from, to])).toEqual(
      [
        ["command", 0, 11],
        ["project", 18, 23],
      ],
    );
    expect(next.text.slice(18, 23)).toBe("@spec");
    expect(withAutomationCommand({ ...draft, ...next })).toEqual(next);
  });

  it("prefixes plain text", () => {
    expect(
      withAutomationCommand({ text: "  every morning", mentions: [], attachments: [] })
        .text,
    ).toBe("/automation every morning");
  });
});
