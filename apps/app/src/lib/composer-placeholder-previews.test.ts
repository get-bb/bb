import { describe, expect, it } from "vitest";
import {
  getComposerPlaceholderPreview,
  setComposerPlaceholderPreview,
} from "./composer-placeholder-previews";

describe("composer placeholder previews", () => {
  it("shows the most recent preview and falls back as owners clear", () => {
    const storageKey = "composer-placeholder-previews-latest";
    const first = Symbol("first");
    const second = Symbol("second");

    setComposerPlaceholderPreview(storageKey, first, "First preview");
    setComposerPlaceholderPreview(storageKey, second, "Second preview");
    expect(getComposerPlaceholderPreview(storageKey)).toBe("Second preview");

    setComposerPlaceholderPreview(storageKey, first, "First again");
    expect(getComposerPlaceholderPreview(storageKey)).toBe("First again");

    setComposerPlaceholderPreview(storageKey, first, null);
    expect(getComposerPlaceholderPreview(storageKey)).toBe("Second preview");

    setComposerPlaceholderPreview(storageKey, second, null);
    expect(getComposerPlaceholderPreview(storageKey)).toBeNull();
  });

  it("keeps composers independent and ignores a null storage key", () => {
    const owner = Symbol("owner");
    setComposerPlaceholderPreview("composer-a", owner, "Only in A");
    setComposerPlaceholderPreview(null, owner, "Nowhere");
    expect(getComposerPlaceholderPreview("composer-a")).toBe("Only in A");
    expect(getComposerPlaceholderPreview("composer-b")).toBeNull();
    expect(getComposerPlaceholderPreview(null)).toBeNull();
    setComposerPlaceholderPreview("composer-a", owner, null);
  });
});
