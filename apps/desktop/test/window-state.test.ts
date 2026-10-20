import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPersistedWindowStateFile,
  restoreWindowState,
  writePersistedWindowStateFile,
} from "../src/window-state.js";
import {
  DEFAULT_WINDOW_STATE,
  type DisplayWorkArea,
  type PersistedWindowStateEntry,
  type PersistedWindowState,
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
        displayWorkAreas,
        persistedState,
      }),
    ).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("requires meaningful overlap with a display work area", () => {
    expect(
      restoreWindowState({
        displayWorkAreas,
        persistedState: {
          bounds: {
            height: 400,
            width: 400,
            x: 1_435,
            y: 895,
          },
          isFullScreen: false,
          isMaximized: false,
        },
      }),
    ).toEqual(DEFAULT_WINDOW_STATE);
  });

  it.each([undefined, -1, 100, "large"])(
    "reads legacy geometry and defaults invalid zoom %s",
    async (zoomFactor) => {
      const tempDir = await createTempDir();
      await writeFile(
        join(tempDir.path, "window-state.json"),
        JSON.stringify({
          windows: [{ ...DEFAULT_WINDOW_STATE, stateKey: "main" }],
          zoomFactor,
        }),
      );
      expect(
        await readPersistedWindowStateFile({ userDataPath: tempDir.path }),
      ).toEqual({
        windows: [{ ...DEFAULT_WINDOW_STATE, stateKey: "main" }],
        zoomFactor: 1,
      });
    },
  );

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

    const file = { windows: persistedStates, zoomFactor: 1.3 };
    await writePersistedWindowStateFile({
      file,
      userDataPath: tempDir.path,
    });

    await expect(
      readPersistedWindowStateFile({ userDataPath: tempDir.path }),
    ).resolves.toEqual(file);
  });
});
