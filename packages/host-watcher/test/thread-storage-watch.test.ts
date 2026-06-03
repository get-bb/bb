import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ApplicationDataWatchTarget,
  ThreadStorageWatchTarget,
} from "../src/host-watcher-types.js";
import {
  collectApplicationStorageObservedChanges,
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
        path.join(rootPath, "app_status", "manifest.json"),
        path.join(rootPath, "app_new"),
        path.join(rootPath, "bad.app", "data", "state.json"),
        path.join(rootPath, ".tmp-app_app_status-abc", "manifest.json"),
        path.join(rootPath, ".delete-app_app_status-abc", "manifest.json"),
      ],
      resolveApplicationTarget: createApplicationResolver({}),
    });

    expect(changes).toEqual([
      { kind: "application-storage-targets-changed" },
    ]);
  });

  it("emits targeted app data changes", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app_status", "data", "state.json"),
        path.join(rootPath, "app_status", "data", "state.json"),
        path.join(rootPath, "app_kanban", "data", "cards", "1"),
        path.join(rootPath, "app_unknown", "data", "state.json"),
        path.join(rootPath, ".tmp-app_app_status-abc", "data", "state.json"),
      ],
      resolveApplicationTarget: createApplicationResolver({
        app_status: {
          applicationId: "app_status",
          appDataPath: path.join(rootPath, "app_status", "data"),
        },
        app_kanban: {
          applicationId: "app_kanban",
          appDataPath: path.join(rootPath, "app_kanban", "data"),
        },
      }),
    });

    expect(changes).toEqual([
      {
        kind: "application-data-changed",
        applicationId: "app_status",
        appDataPath: path.join(rootPath, "app_status", "data"),
        path: "state.json",
      },
      {
        kind: "application-data-changed",
        applicationId: "app_kanban",
        appDataPath: path.join(rootPath, "app_kanban", "data"),
        path: "cards/1",
      },
    ]);
  });

  it("emits app data resync hints for unclassifiable app data changes", () => {
    const rootPath = path.join("/tmp", "apps");
    const changes = collectApplicationStorageObservedChanges({
      appsRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "app_status", "data"),
        path.join(rootPath, "app_status", "data", ".state.tmp"),
        path.join(rootPath, "app_status", "data"),
      ],
      resolveApplicationTarget: createApplicationResolver({}),
    });

    expect(changes).toEqual([
      {
        kind: "application-data-resync",
        applicationId: "app_status",
      },
    ]);
  });
});
