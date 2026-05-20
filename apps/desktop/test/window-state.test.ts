import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasVisibleArea,
  readPersistedWindowStateEntries,
  readPersistedWindowState,
  restoreWindowState,
  writePersistedWindowStateEntries,
  writePersistedWindowState,
} from "../src/window-state.js";
import type {
  DefaultWindowState,
  DisplayWorkArea,
  PersistedWindowStateEntry,
  PersistedWindowState,
} from "../src/types.js";

interface TempDir {
  path: string;
}

const displayWorkAreas: DisplayWorkArea[] = [
  {
    height: 900,
    width: 1440,
    x: 0,
    y: 0,
  },
];

const defaultState: DefaultWindowState = {
  bounds: {
    height: 900,
    width: 1280,
    x: 80,
    y: 80,
  },
  isFullScreen: false,
  isMaximized: false,
};

const tempDirs: TempDir[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-window-state-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

describe("window state helpers", () => {
  it("restores a persisted state when the bounds are visible", () => {
    const persistedState: PersistedWindowState = {
      bounds: {
        height: 700,
        width: 1024,
        x: 100,
        y: 100,
      },
      isFullScreen: false,
      isMaximized: true,
    };

    expect(
      restoreWindowState({
        defaultState,
        displayWorkAreas,
        persistedState,
      }),
    ).toEqual(persistedState);
  });

  it("falls back when the persisted bounds are offscreen", () => {
    const persistedState: PersistedWindowState = {
      bounds: {
        height: 700,
        width: 1024,
        x: 10_000,
        y: 10_000,
      },
      isFullScreen: false,
      isMaximized: true,
    };

    expect(
      restoreWindowState({
        defaultState,
        displayWorkAreas,
        persistedState,
      }),
    ).toEqual(defaultState);
  });

  it("requires meaningful overlap with a display work area", () => {
    expect(
      hasVisibleArea({
        bounds: {
          height: 400,
          width: 400,
          x: 1_435,
          y: 895,
        },
        displayWorkAreas,
      }),
    ).toBe(false);
  });

  it("persists and reads window state from disk", async () => {
    const tempDir = await createTempDir();
    const persistedState: PersistedWindowState = {
      bounds: {
        height: 720,
        width: 1100,
        x: 40,
        y: 60,
      },
      isFullScreen: false,
      isMaximized: true,
    };

    await writePersistedWindowState({
      state: persistedState,
      stateKey: "main",
      userDataPath: tempDir.path,
    });

    await expect(
      readPersistedWindowState({
        stateKey: "main",
        userDataPath: tempDir.path,
      }),
    ).resolves.toEqual(persistedState);
  });

  it("persists and reads multiple window states across restart", async () => {
    const tempDir = await createTempDir();
    const persistedStates: PersistedWindowStateEntry[] = [
      {
        bounds: {
          height: 720,
          width: 1100,
          x: 40,
          y: 60,
        },
        isFullScreen: false,
        isMaximized: true,
        stateKey: "main",
      },
      {
        bounds: {
          height: 740,
          width: 1120,
          x: 240,
          y: 160,
        },
        isFullScreen: false,
        isMaximized: false,
        stateKey: "window-2",
      },
    ];

    await writePersistedWindowStateEntries({
      entries: persistedStates,
      userDataPath: tempDir.path,
    });

    await expect(
      readPersistedWindowStateEntries({ userDataPath: tempDir.path }),
    ).resolves.toEqual(persistedStates);
  });

  it("reads legacy single-window state as the main window entry", async () => {
    const tempDir = await createTempDir();
    const legacyState: PersistedWindowState = {
      bounds: {
        height: 720,
        width: 1100,
        x: 40,
        y: 60,
      },
      isFullScreen: false,
      isMaximized: true,
    };

    await writeFile(
      join(tempDir.path, "window-state.json"),
      `${JSON.stringify(legacyState, null, 2)}\n`,
      "utf8",
    );

    await expect(
      readPersistedWindowStateEntries({ userDataPath: tempDir.path }),
    ).resolves.toEqual([
      {
        ...legacyState,
        stateKey: "main",
      },
    ]);
  });
});
