import { describe, expect, it } from "vitest";
import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { composeTipDraft } from "./compose.js";

function draft(
  text: string,
  mentions: ComposerDraftSnapshot["mentions"] = [],
): ComposerDraftSnapshot {
  return { text, mentions, attachments: [] };
}

const SLOT_PROMPT = "Compare three approaches. Task: ";
const PLAIN_PROMPT = "Review my bb setup.";

describe("composeTipDraft", () => {
  it("fills an empty draft with the prompt", () => {
    expect(composeTipDraft(SLOT_PROMPT, draft("  "))).toEqual({
      text: SLOT_PROMPT,
      mentions: [],
    });
  });

  it("moves the draft into the prompt's task slot and keeps its mentions", () => {
    const current = draft("  fix @login now ", [
      {
        kind: "project",
        projectId: "proj_1",
        label: "@login",
        from: 6,
        to: 12,
      },
    ]);
    const next = composeTipDraft(SLOT_PROMPT, current);
    expect(next.text).toBe(`${SLOT_PROMPT}fix @login now`);
    const [mention] = next.mentions;
    expect(next.text.slice(mention?.from, mention?.to)).toBe("@login");
  });

  it("appends a prompt without a task slot after the draft", () => {
    expect(composeTipDraft(PLAIN_PROMPT, draft("my notes\n"))).toEqual({
      text: `my notes\n\n${PLAIN_PROMPT}`,
      mentions: [],
    });
  });

  it("leaves a draft that already holds the prompt unchanged", () => {
    const current = draft(`${SLOT_PROMPT}fix it`);
    expect(composeTipDraft(SLOT_PROMPT, current)).toBe(current);
  });
});
