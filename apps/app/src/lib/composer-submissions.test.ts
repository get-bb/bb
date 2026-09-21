import { describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import {
  notifyComposerSubmitted,
  removePluginMention,
  subscribeComposerSubmitted,
} from "./composer-submissions";

describe("composer submissions", () => {
  it("scopes notifications and disposes listeners", () => {
    const listener = vi.fn();
    const dispose = subscribeComposerSubmitted(
      { kind: "thread", threadId: "one" },
      listener,
    );
    notifyComposerSubmitted({ kind: "thread", threadId: "two" });
    expect(listener).not.toHaveBeenCalled();
    notifyComposerSubmitted({ kind: "thread", threadId: "one" });
    expect(listener).toHaveBeenCalledOnce();
    dispose();
    notifyComposerSubmitted({ kind: "thread", threadId: "one" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("removes only owned mentions, rebases remaining mentions, and keeps attachments", () => {
    const draft: PromptDraftState = {
      text: "same same tail",
      attachments: [],
      mentions: [
        {
          start: 0,
          end: 4,
          resource: {
            kind: "plugin",
            pluginId: "annotations",
            itemId: "annotation:1",
            label: "same",
            icon: null,
          },
        },
        {
          start: 5,
          end: 9,
          resource: {
            kind: "plugin",
            pluginId: "other",
            itemId: "annotation:1",
            label: "same",
            icon: null,
          },
        },
      ],
    };
    const next = removePluginMention(draft, "annotations", "annotation", "1");
    expect(next.text).toBe(" same tail");
    expect(next.mentions).toEqual([{ ...draft.mentions[1], start: 1, end: 5 }]);
    expect(next.attachments).toBe(draft.attachments);
    expect(removePluginMention(next, "annotations", "annotation", "1")).toBe(
      next,
    );
    expect(draft.text).toBe("same same tail");
  });
});
