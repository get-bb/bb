import type { PromptHistoryEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  prependPromptHistoryEntry,
  promptHistoryEntriesToDrafts,
} from "./prompt-history";

describe("prompt history helpers", () => {
  it("drops entries that cannot be edited back into a prompt draft", () => {
    const drafts = promptHistoryEntriesToDrafts([
      {
        id: "entry-1",
        createdAt: 2,
        input: [{ type: "image", url: "https://example.com/image.png" }],
      },
      {
        id: "entry-2",
        createdAt: 1,
        input: [{ type: "text", text: "Ship it", mentions: [] }],
      },
    ]);

    expect(drafts).toEqual([
      {
        text: "Ship it",
        mentions: [],
        attachments: [],
      },
    ]);
  });

  it("collapses consecutive history entries that map to the same editable draft", () => {
    const drafts = promptHistoryEntriesToDrafts([
      {
        id: "entry-2",
        createdAt: 2,
        input: [
          { type: "text", text: "Ship it", mentions: [] },
          { type: "image", url: "https://example.com/image.png" },
        ],
      },
      {
        id: "entry-1",
        createdAt: 1,
        input: [{ type: "text", text: "Ship it", mentions: [] }],
      },
    ]);

    expect(drafts).toEqual([
      {
        text: "Ship it",
        mentions: [],
        attachments: [],
      },
    ]);
  });

  it("collapses exact consecutive duplicates when prepending a new entry", () => {
    const entries: PromptHistoryEntry[] = [
      {
        id: "entry-1",
        createdAt: 2,
        input: [{ type: "text", text: "Latest", mentions: [] }],
      },
      {
        id: "entry-2",
        createdAt: 1,
        input: [{ type: "text", text: "Older", mentions: [] }],
      },
    ];

    const nextEntries = prependPromptHistoryEntry(entries, {
      id: "entry-3",
      createdAt: 3,
      input: [{ type: "text", text: "Latest", mentions: [] }],
    });

    expect(nextEntries).toEqual([
      {
        id: "entry-3",
        createdAt: 3,
        input: [{ type: "text", text: "Latest", mentions: [] }],
      },
      {
        id: "entry-2",
        createdAt: 1,
        input: [{ type: "text", text: "Older", mentions: [] }],
      },
    ]);
  });
});
