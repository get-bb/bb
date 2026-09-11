// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePromptDraftStorage } from "@bb/client-core";
import {
  importLegacyNewThreadDraft,
  newThreadDraftStorageKey,
  parseNewThreadDraft,
  readNewThreadDrafts,
  serializeNewThreadDraft,
  type NewThreadDraft,
} from "./new-thread-drafts";

const legacyKey = "bb.promptbox.contents-draft-3";
const destination = { projectId: "proj_drafts", sectionId: "sec_drafts" };

function draft(id: string, text: string): NewThreadDraft {
  return {
    id,
    prompt: { text, mentions: [], attachments: [] },
    destination,
    lastEditedAt: 100,
    options: {
      providerId: "provider_test",
      model: "model_test",
      reasoningLevel: "xhigh",
      serviceTier: "fast",
      permissionMode: "auto",
      environmentSelectionValue: "provider:worktree",
      environmentMachine: { type: "existing", hostId: "host_drafts" },
      environmentProviderInputs: { branch: { kind: "named", name: "main" } },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("new thread draft persistence", () => {
  it("keeps destination, provider inputs and selections with each prompt", () => {
    const first = draft("first", "First independent prompt");
    const second = {
      ...draft("second", "Second independent prompt"),
      destination: { projectId: "proj_other", sectionId: null },
      options: null,
      lastEditedAt: 200,
    };
    for (const value of [first, second]) {
      localStorage.setItem(
        newThreadDraftStorageKey(value.id),
        serializeNewThreadDraft(value)!,
      );
    }

    expect(readNewThreadDrafts(localStorage)).toEqual([
      expect.objectContaining(second),
      expect.objectContaining(first),
    ]);
    expect(parsePromptDraftStorage(serializeNewThreadDraft(first))).toEqual(
      first.prompt,
    );
  });

  it("does not turn option-only panes into saved drafts", () => {
    expect(serializeNewThreadDraft(draft("blank", ""))).toBeNull();
  });

  it("leaves malformed and newer-version records untouched while reading", () => {
    const malformedKey = newThreadDraftStorageKey("malformed");
    const futureKey = newThreadDraftStorageKey("future");
    const future = JSON.stringify({ version: 2, text: "Future draft" });
    localStorage.setItem(malformedKey, "unfinished JSON");
    localStorage.setItem(futureKey, future);
    localStorage.setItem("bb.promptbox.contents-existing-3", "unrelated");

    expect(readNewThreadDrafts(localStorage)).toEqual([]);
    expect(localStorage.getItem(malformedKey)).toBe("unfinished JSON");
    expect(localStorage.getItem(futureKey)).toBe(future);
    expect(localStorage.length).toBe(3);
  });
});

describe("singleton draft import", () => {
  const importLegacy = () =>
    importLegacyNewThreadDraft({
      storage: localStorage,
      destination,
      options: null,
      now: 100,
    });

  it("imports once and does not resurrect a consumed draft", () => {
    const prompt = {
      text: "Existing singleton",
      mentions: [
        {
          start: 0,
          end: 8,
          resource: { kind: "project", projectId: "proj_drafts" },
        },
      ],
      attachments: [
        {
          type: "localFile",
          path: "/projects/proj_drafts/attachments/notes.txt",
          name: "notes.txt",
          sizeBytes: 20,
        },
      ],
    };
    const original = JSON.stringify(prompt);
    localStorage.setItem(legacyKey, original);
    const id = importLegacy()!;
    expect(importLegacy()).toBe(id);
    expect(readNewThreadDrafts(localStorage)).toHaveLength(1);
    expect(readNewThreadDrafts(localStorage)[0]).toMatchObject({
      destination,
      prompt,
    });

    localStorage.removeItem(newThreadDraftStorageKey(id));
    importLegacy();
    expect(readNewThreadDrafts(localStorage)).toHaveLength(0);
    expect(localStorage.getItem(legacyKey)).toBe(original);
  });

  it("preserves the original if storage fills and retries without duplicating", () => {
    const original = JSON.stringify({
      text: "Keep this prompt",
      attachments: [],
    });
    localStorage.setItem(legacyKey, original);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      expect(importLegacy).toThrow("quota");
      expect(localStorage.getItem(legacyKey)).toBe(original);
    } finally {
      setItem.mockRestore();
    }
    const id = importLegacy()!;
    expect(importLegacy()).toBe(id);
    expect(readNewThreadDrafts(localStorage)).toHaveLength(1);
  });

  it("retries an interrupted import without overwriting an edited record", () => {
    localStorage.setItem(
      legacyKey,
      JSON.stringify({ text: "Original singleton", attachments: [] }),
    );
    const nativeSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key.endsWith("legacy-import.1")) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        nativeSetItem.call(this, key, value);
      });
    try {
      expect(importLegacy).toThrow("quota");
    } finally {
      setItem.mockRestore();
    }
    const imported = readNewThreadDrafts(localStorage)[0]!;
    localStorage.setItem(
      newThreadDraftStorageKey(imported.id),
      serializeNewThreadDraft({
        ...imported,
        prompt: { text: "Newer edits", mentions: [], attachments: [] },
      })!,
    );

    const id = importLegacy()!;
    expect(id).not.toBe(imported.id);
    expect(readNewThreadDrafts(localStorage)).toHaveLength(2);
    expect(
      parseNewThreadDraft(
        imported.id,
        localStorage.getItem(newThreadDraftStorageKey(imported.id)),
      )?.prompt.text,
    ).toBe("Newer edits");
  });
});
