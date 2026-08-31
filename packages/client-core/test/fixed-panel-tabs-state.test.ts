import { describe, expect, it } from "vitest";
import {
  areFixedPanelTabsEquivalent,
  createByteFilePreviewFixedPanelTab,
} from "../src/panel/fixed-panel-tabs-state.js";

describe("byte file preview tab equivalence", () => {
  it("compares all byte identity and preview fields", () => {
    const first = createByteFilePreviewFixedPanelTab({
      tab: {
        displayName: "report.pdf",
        lineRange: { startLineNumber: 2, endLineNumber: 7 },
        mimeType: "application/pdf",
        ownerId: "task-1",
        resourceId: "attachment-1",
        sizeBytes: 42,
        source: "tasks-attachment",
      },
    });
    const second = createByteFilePreviewFixedPanelTab({
      tab: {
        displayName: "report.pdf",
        lineRange: { startLineNumber: 2, endLineNumber: 7 },
        mimeType: "application/pdf",
        ownerId: "task-1",
        resourceId: "attachment-1",
        sizeBytes: 42,
        source: "tasks-attachment",
      },
    });

    expect(areFixedPanelTabsEquivalent(first, second)).toBe(true);
    for (const changed of [
      { ...second, displayName: "other.pdf" },
      { ...second, mimeType: "application/octet-stream" },
      { ...second, sizeBytes: 43 },
      {
        ...second,
        lineRange: { startLineNumber: 3, endLineNumber: 7 },
      },
    ]) {
      expect(areFixedPanelTabsEquivalent(first, changed)).toBe(false);
    }
  });
});
