import type { PromptMentionResource } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createComposerValue } from "./document";
import {
  buildTypeaheadTriggers,
  findActiveComposerTrigger,
  maskMentionRanges,
} from "./trigger";

const THREAD: PromptMentionResource = {
  kind: "thread",
  threadId: "thr_1",
  projectId: "proj_1",
  label: "Fix @login",
};

const TRIGGERS = buildTypeaheadTriggers({
  mentionTriggers: ["@", "#"],
  commandTrigger: "/",
});

describe("findActiveComposerTrigger", () => {
  it("reports the mention query under the caret with display offsets", () => {
    const value = createComposerValue("ask @fix-lo now");
    expect(
      findActiveComposerTrigger(value, { start: 11, end: 11 }, TRIGGERS),
    ).toEqual({ char: "@", kind: "mention", query: "fix-lo", from: 4, to: 11 });
  });

  it("does not fire mid-word or for a range selection", () => {
    const value = createComposerValue("mail@host");
    expect(
      findActiveComposerTrigger(value, { start: 9, end: 9 }, TRIGGERS),
    ).toBeNull();
    expect(
      findActiveComposerTrigger(
        createComposerValue("@abc"),
        { start: 1, end: 4 },
        TRIGGERS,
      ),
    ).toBeNull();
  });

  it("masks pills so their text is never a query and acts as a boundary", () => {
    // "@Fix @login" is one pill; the caret right after it + "@x" must start a
    // fresh query, and the caret inside the pill label must not.
    const value = createComposerValue("@Fix @login@x", [
      { start: 0, end: 11, resource: THREAD, serializedText: "@thread:thr_1" },
    ]);
    expect(maskMentionRanges(value)).toBe("\n".repeat(11) + "@x");
    expect(
      findActiveComposerTrigger(value, { start: 13, end: 13 }, TRIGGERS),
    ).toEqual({ char: "@", kind: "mention", query: "x", from: 11, to: 13 });
    expect(
      findActiveComposerTrigger(value, { start: 7, end: 7 }, TRIGGERS),
    ).toBeNull();
  });

  it("captures whole namespaced command tokens and the empty command query", () => {
    expect(
      findActiveComposerTrigger(
        createComposerValue("/frontend:comp"),
        { start: 14, end: 14 },
        TRIGGERS,
      ),
    ).toEqual({
      char: "/",
      kind: "command",
      query: "frontend:comp",
      from: 0,
      to: 14,
    });
    expect(
      findActiveComposerTrigger(
        createComposerValue("hi /"),
        { start: 4, end: 4 },
        TRIGGERS,
      ),
    ).toEqual({ char: "/", kind: "command", query: "", from: 3, to: 4 });
  });

  it("ignores the command trigger when the provider has none", () => {
    const mentionOnly = buildTypeaheadTriggers({
      mentionTriggers: ["@"],
      commandTrigger: null,
    });
    expect(
      findActiveComposerTrigger(
        createComposerValue("/rev"),
        { start: 4, end: 4 },
        mentionOnly,
      ),
    ).toBeNull();
  });
});
