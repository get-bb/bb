import { describe, expect, it, vi } from "vitest";
import {
  canEditWorkspaceFile,
  saveWorkspaceFile,
  WORKSPACE_EDITABLE_FILE_LIMIT_BYTES,
} from "./WorkspaceFileEditor";

describe("WorkspaceFileEditor", () => {
  it("edits only UTF-8 files up to and including 2 MiB", () => {
    expect(
      canEditWorkspaceFile({
        contentEncoding: "utf8",
        sizeBytes: WORKSPACE_EDITABLE_FILE_LIMIT_BYTES,
      }),
    ).toBe(true);
    expect(
      canEditWorkspaceFile({
        contentEncoding: "utf8",
        sizeBytes: WORKSPACE_EDITABLE_FILE_LIMIT_BYTES + 1,
      }),
    ).toBe(false);
    expect(
      canEditWorkspaceFile({ contentEncoding: "base64", sizeBytes: 1 }),
    ).toBe(false);
  });

  it("passes the read hash as the compare-and-swap save guard", async () => {
    const writer = vi.fn(async () => ({
      outcome: "conflict" as const,
      currentSha256: "newer",
    }));

    await expect(
      saveWorkspaceFile(writer, {
        content: "local edit",
        expectedSha256: "baseline",
        hostId: "host-1",
        path: "/repo/README.md",
        rootPath: "/repo",
      }),
    ).resolves.toEqual({ outcome: "conflict", currentSha256: "newer" });
    expect(writer).toHaveBeenCalledWith({
      content: "local edit",
      expectedSha256: "baseline",
      hostId: "host-1",
      path: "/repo/README.md",
      rootPath: "/repo",
    });
  });
});
