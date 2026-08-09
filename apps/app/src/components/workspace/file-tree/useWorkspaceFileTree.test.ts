import { describe, expect, it } from "vitest";
import type { WorkspaceDirectoryEntry } from "@bb/host-daemon-contract";
import { BbHttpError } from "@bb/sdk/browser";
import {
  isPreparingWorktreeError,
  mergeWorkspaceDirectoryEntries,
  workspaceEntryTreePath,
} from "./useWorkspaceFileTree";

describe("workspace file tree data", () => {
  it("recognizes a provisioning environment as a temporary worktree state", () => {
    const error = new BbHttpError({
      status: 409,
      code: "environment_not_ready",
      message: "Environment unavailable",
      body: {
        code: "environment_not_ready",
        message: "Environment unavailable",
        details: {
          environmentStatus: "provisioning",
          hasPath: false,
        },
      },
    });

    expect(isPreparingWorktreeError(error)).toBe(true);
    expect(
      isPreparingWorktreeError(
        new BbHttpError({
          status: 409,
          code: "environment_not_ready",
          message: "Environment unavailable",
          body: {
            code: "environment_not_ready",
            message: "Environment unavailable",
            details: { environmentStatus: "error", hasPath: false },
          },
        }),
      ),
    ).toBe(false);
  });

  it("preserves literal hidden and generated paths", () => {
    const entries: WorkspaceDirectoryEntry[] = [
      { kind: "directory", name: ".git", path: ".git" },
      { kind: "directory", name: "node_modules", path: "node_modules" },
      { kind: "file", name: ".env", path: ".env" },
      { kind: "symlink", name: "outside", path: "outside" },
    ];

    expect(entries.map(workspaceEntryTreePath)).toEqual([
      ".git/",
      "node_modules/",
      ".env",
      "outside",
    ]);
  });

  it("deduplicates a path repeated after a concurrent page change", () => {
    const first = mergeWorkspaceDirectoryEntries(new Map(), [
      { kind: "file", name: "a.ts", path: "src/a.ts" },
    ]);
    const merged = mergeWorkspaceDirectoryEntries(first, [
      { kind: "file", name: "a.ts", path: "src/a.ts" },
      { kind: "file", name: "b.ts", path: "src/b.ts" },
    ]);

    expect([...merged.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
