import fs from "node:fs/promises";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { createDeferredPromise, makeTempDir } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectDataDirSkillsObservedChanges,
  createParcelHostWatcher,
} from "../src/parcel-host-watcher.js";

type ParcelWatcherSubscribe = (typeof import("@parcel/watcher"))["subscribe"];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("thread storage watcher", () => {
  it("creates and watches only the thread's own storage directory", async () => {
    const root = await fs.realpath(await makeTempDir("bb-thread-storage-"));
    const watchedPath = path.join(root, "thr_watched");
    const subscribed = createDeferredPromise<{
      callback: ParcelWatcherCallback;
      rootPath: string;
    }>();
    const unsubscribe = vi.fn(async () => undefined);
    vi.spyOn(parcelWatcher, "subscribe").mockImplementation(
      async (rootPath, callback) => {
        subscribed.resolve({ callback, rootPath });
        return { unsubscribe };
      },
    );
    const onChange = vi.fn();
    const onWatchError = vi.fn();

    const stopWatching = createParcelHostWatcher().watchThreadStorage({
      threadStoragePath: watchedPath,
      onChange,
      onWatchError,
    });
    const { callback, rootPath } = await subscribed.promise;

    expect(rootPath).toBe(watchedPath);
    expect((await fs.stat(watchedPath)).isDirectory()).toBe(true);

    callback(null, [
      { path: path.join(watchedPath, "notes.md"), type: "create" },
    ]);
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    await stopWatching();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onWatchError).not.toHaveBeenCalled();
  });
});

describe("data-dir skills watcher classification", () => {
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
