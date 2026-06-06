import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ApplicationDataWatchTarget,
  ThreadStorageWatchTarget,
} from "../src/host-watcher-types.js";
import {
  collectApplicationDataObservedChanges,
  collectApplicationStorageObservedChanges,
  collectDataDirSkillsObservedChanges,
  collectThreadStorageObservedChanges,
} from "../src/parcel-host-watcher.js";

function createResolver(
  targets: Record<string, ThreadStorageWatchTarget>,
): (threadId: string) => ThreadStorageWatchTarget | null {
  return (threadId) => targets[threadId] ?? null;
}

function createApplicationResolver(
  targets: Record<string, ApplicationDataWatchTarget>,
): (applicationId: string) => ApplicationDataWatchTarget | null {
  return (applicationId) => targets[applicationId] ?? null;
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

  it("emits app storage target refreshes for app folders and manifests", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "manifest.json"),
        path.join(rootPath, "app_new"),
        path.join(rootPath, "bad.app", "manifest.json"),
        path.join(rootPath, ".tmp-app_app-status-abc", "manifest.json"),
        path.join(rootPath, ".delete-app_app-status-abc", "manifest.json"),
      ],
    });

    expect(changes).toEqual([
      { kind: "application-storage-targets-changed" },
    ]);
  });

  it("emits targeted app data changes from the app-data root", () => {
    const appDataRootPath = path.join("/tmp", "app-data");
    const changes = collectApplicationDataObservedChanges({
      appDataRootPath,
      changedPaths: [
        path.join(appDataRootPath, "app-status", "state.json"),
        path.join(appDataRootPath, "app-status", "state.json"),
        path.join(appDataRootPath, "app-kanban", "cards", "1"),
        path.join(appDataRootPath, "app-unknown", "state.json"),
        path.join("/tmp", "apps", "app-status", "public", "index.html"),
      ],
      resolveApplicationTarget: createApplicationResolver({
        "app-status": {
          applicationId: "app-status",
          appDataPath: path.join(appDataRootPath, "app-status"),
        },
        "app-kanban": {
          applicationId: "app-kanban",
          appDataPath: path.join(appDataRootPath, "app-kanban"),
        },
      }),
    });

    expect(changes).toEqual([
      {
        kind: "application-data-changed",
        applicationId: "app-status",
        appDataPath: path.join(appDataRootPath, "app-status"),
        path: "state.json",
      },
      {
        kind: "application-data-changed",
        applicationId: "app-kanban",
        appDataPath: path.join(appDataRootPath, "app-kanban"),
        path: "cards/1",
      },
    ]);
  });

  it("emits app data resync hints for whole-dir or unclassifiable changes", () => {
    const appDataRootPath = path.join("/tmp", "app-data");
    const changes = collectApplicationDataObservedChanges({
      appDataRootPath,
      changedPaths: [
        path.join(appDataRootPath, "app-status"),
        path.join(appDataRootPath, "app-status", ".state.tmp"),
        path.join(appDataRootPath, "app-status"),
      ],
      resolveApplicationTarget: createApplicationResolver({}),
    });

    expect(changes).toEqual([
      {
        kind: "application-data-resync",
        applicationId: "app-status",
      },
    ]);
  });

  it("emits one app content change for a file under public/", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "public", "index.html"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "application-content-changed",
        applicationId: "app-status",
      },
    ]);
  });

  it("dedupes content changes per app and emits one event per changed app", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "public", "index.html"),
        path.join(rootPath, "app-status", "public", "assets", "main.js"),
        path.join(rootPath, "app-status", "public", "assets", "main.css"),
        path.join(rootPath, "app-kanban", "public", "index.html"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "application-content-changed",
        applicationId: "app-status",
      },
      {
        kind: "application-content-changed",
        applicationId: "app-kanban",
      },
    ]);
  });

  it("treats the bare public directory itself as an app content change", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [path.join(rootPath, "app-status", "public")],
    });

    expect(changes).toEqual([
      {
        kind: "application-content-changed",
        applicationId: "app-status",
      },
    ]);
  });

  it("leaves source/ and other unknown app subtrees unclassified", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "source", "index.tsx"),
        path.join(rootPath, "app-status", "source", "components", "App.tsx"),
        path.join(rootPath, "app-status", "README.md"),
      ],
    });

    expect(changes).toEqual([]);
  });

  it("ignores public changes inside temporary app staging entries", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, ".tmp-app_app-status-abc", "public", "index.html"),
        path.join(rootPath, ".delete-app_app-status-abc", "public", "index.html"),
      ],
    });

    expect(changes).toEqual([]);
  });

  it("ignores app data paths under the apps root (data lives in the app-data root)", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-untracked", "public", "index.html"),
        // A stray apps/<id>/data path (e.g. an unmigrated legacy dir) must not
        // be classified as app data — data is watched under the app-data root.
        path.join(rootPath, "app-untracked", "data", "state.json"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "application-content-changed",
        applicationId: "app-untracked",
      },
    ]);
  });

  it("classifies mixed apps-root batches into targets and content changes", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "manifest.json"),
        path.join(rootPath, "app-status", "public", "index.html"),
      ],
    });

    expect(changes).toEqual([
      { kind: "application-storage-targets-changed" },
      {
        kind: "application-content-changed",
        applicationId: "app-status",
      },
    ]);
  });

  it("emits injected skill changes for app skill trees", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app-status", "skills", "demo-skill", "SKILL.md"),
        path.join(rootPath, "app-status", "skills", "demo-skill", "references", "notes.md"),
        path.join(rootPath, "app-other", "skills"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "injected-skills-changed",
        applicationId: "app-status",
        changedPaths: [
          path.join(rootPath, "app-status", "skills", "demo-skill", "SKILL.md"),
          path.join(
            rootPath,
            "app-status",
            "skills",
            "demo-skill",
            "references",
            "notes.md",
          ),
        ],
        sourceType: "global-app",
      },
      {
        kind: "injected-skills-changed",
        applicationId: "app-other",
        changedPaths: [path.join(rootPath, "app-other", "skills")],
        sourceType: "global-app",
      },
    ]);
  });

  it("emits injected skill changes for data-dir-level skills", () => {
    const rootPath = path.join("/tmp", "skills");
    const changes = collectDataDirSkillsObservedChanges({
      dataDirSkillsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "demo-skill", "SKILL.md"),
        path.join(rootPath, "..", "apps", "app-status", "skills", "demo", "SKILL.md"),
      ],
    });

    expect(changes).toEqual([
      {
        kind: "injected-skills-changed",
        applicationId: null,
        changedPaths: [path.join(rootPath, "demo-skill", "SKILL.md")],
        sourceType: "data-dir",
      },
    ]);
  });
});
