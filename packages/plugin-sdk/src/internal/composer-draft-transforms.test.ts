import { expect, it } from "vitest";
import type { ComposerDraftSnapshot } from "../app-contract.js";
import {
  removeComposerMentions,
  setComposerText,
} from "./composer-draft-transforms.js";

it("removes multiple selected pills and rebases surviving UTF-16 ranges without mutating the snapshot", () => {
  const draft: ComposerDraftSnapshot = {
    text: "🙂 @a @keep @b @last",
    mentions: [
      { kind: "thread", threadId: "a", label: "a", from: 3, to: 5 },
      {
        kind: "project",
        projectId: "keep",
        label: "keep",
        from: 6,
        to: 11,
      },
      { kind: "thread", threadId: "b", label: "b", from: 12, to: 14 },
      {
        kind: "project",
        projectId: "last",
        label: "last",
        from: 15,
        to: 20,
      },
    ],
    attachments: [
      {
        type: "localFile",
        path: "spec.txt",
        name: "spec.txt",
        sizeBytes: 1,
      },
    ],
  };
  const next = removeComposerMentions(
    draft,
    (mention) => mention.kind === "thread",
  );
  expect(next.text).toBe("🙂  @keep  @last");
  expect(next.mentions).toMatchObject([
    { from: 4, to: 9, projectId: "keep" },
    { from: 11, to: 16, projectId: "last" },
  ]);
  expect(next.attachments).toBe(draft.attachments);
  expect(draft.text).toBe("🙂 @a @keep @b @last");
  expect(removeComposerMentions(draft, () => false)).toBe(draft);
});

it("reconciles text edits outside pills and drops pills overlapped by the changed span", () => {
  const draft: ComposerDraftSnapshot = {
    attachments: [],
    text: "hi @keep end",
    mentions: [
      { kind: "thread", threadId: "keep", label: "keep", from: 3, to: 8 },
    ],
  };
  const shifted = setComposerText(draft, "🙂 hi @keep end");
  expect(shifted.mentions).toMatchObject([{ from: 6, to: 11 }]);
  expect(setComposerText(shifted, "🙂 hi plain end").mentions).toEqual([]);
  expect(setComposerText(draft, draft.text)).toBe(draft);
  expect(draft.mentions).toMatchObject([{ from: 3, to: 8 }]);
});
