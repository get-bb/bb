import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadStorageWatchTarget } from "../src/host-watcher-types.js";
import {
  collectDataDirSkillsObservedChanges,
  collectThreadStorageObservedChanges,
} from "../src/parcel-host-watcher.js";

function createResolver(
  targets: Record<string, ThreadStorageWatchTarget>,
): (threadId: string) => ThreadStorageWatchTarget | null {
  return (threadId) => targets[threadId] ?? null;
}

describe("thread storage watcher classification", () => {
  it("emits broad storage changes for ordinary thread storage changes", () => {
    const rootPath = path.join("/tmp", "thread-storage");
    const changes = collectThreadStorageObservedChanges({
      threadStorageRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "thr_one", "notes.md"),
        path.join(rootPath, "thr_two", "reports", "summary.html"),
        path.join(rootPath, "thr_unknown", "notes.md"),
        path.join(rootPath, "..", "outside", "notes.md"),
      ],
      resolveThreadTarget: createResolver({
        thr_one: {
          environmentId: "env_one",
          threadId: "thr_one",
        },
        thr_two: {
          environmentId: "env_two",
          threadId: "thr_two",
        },
      }),
    });

    expect(changes).toEqual([
      {
        kind: "thread-storage-changed",
        environmentId: "env_one",
        threadId: "thr_one",
      },
      {
        kind: "thread-storage-changed",
        environmentId: "env_two",
        threadId: "thr_two",
      },
    ]);
  });

  it("emits injected skill changes for data-dir-level skills", () => {
    const rootPath = path.join("/tmp", "skills");
    const changes = collectDataDirSkillsObservedChanges({
      dataDirSkillsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "demo-skill", "SKILL.md"),
        path.join(rootPath, "..", "other-skills", "demo", "SKILL.md"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "injected-skills-changed",
        changedPaths: [path.join(rootPath, "demo-skill", "SKILL.md")],
        sourceType: "data-dir",
      },
    ]);
  });
});
