import { randomUUID } from "node:crypto";
import {
  BB_DESKTOP_MIN_ZOOM_PERCENT,
  BB_DESKTOP_MAX_ZOOM_PERCENT,
} from "@bb/desktop-contract";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { screen } from "electron";
import { z } from "zod";
import {
  DEFAULT_WINDOW_STATE,
  type DisplayWorkArea,
  type PersistedWindowStateEntry,
  type PersistedWindowStateFile,
  type PersistedWindowState,
  type WindowBounds,
  type WindowStateKey,
} from "./types.js";

const WINDOW_STATE_FILE_NAME = "window-state.json";
const MIN_VISIBLE_AREA = 10_000;

const windowBoundsSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
  x: z.number().int(),
  y: z.number().int(),
});

const persistedWindowStateSchema = z.object({
  bounds: windowBoundsSchema,
  isFullScreen: z.boolean(),
  isMaximized: z.boolean(),
});

const persistedWindowStateEntrySchema = persistedWindowStateSchema.extend({
  stateKey: z.string().min(1),
});

const persistedWindowStateFileSchema = z.object({
  windows: z.array(persistedWindowStateEntrySchema),
  zoomFactor: z
    .number()
    .min(BB_DESKTOP_MIN_ZOOM_PERCENT / 100)
    .max(BB_DESKTOP_MAX_ZOOM_PERCENT / 100)
    .catch(1),
});

const EMPTY_WINDOW_STATE_FILE: PersistedWindowStateFile = {
  windows: [],
  zoomFactor: 1,
};

interface ReadPersistedWindowStateFileArgs {
  userDataPath: string;
}

interface WritePersistedWindowStateFileArgs {
  file: PersistedWindowStateFile;
  userDataPath: string;
}

interface RestoreWindowStateArgs {
  displayWorkAreas: DisplayWorkArea[];
  persistedState: PersistedWindowState | null;
}

interface HasVisibleAreaArgs {
  bounds: WindowBounds;
  displayWorkAreas: DisplayWorkArea[];
}

export interface StatefulBrowserWindow {
  getNormalBounds(): WindowBounds;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
}

interface RestoreBrowserWindowStateArgs {
  displayWorkAreas: DisplayWorkArea[] | null;
  stateKey: WindowStateKey;
  windows: PersistedWindowStateEntry[];
}

interface CreatePersistedWindowStateEntryArgs {
  browserWindow: StatefulBrowserWindow;
  stateKey: WindowStateKey;
}

interface IntersectingAreaArgs {
  bounds: WindowBounds;
  workArea: DisplayWorkArea;
}

function windowStatePath(userDataPath: string): string {
  return join(userDataPath, WINDOW_STATE_FILE_NAME);
}

function parsePersistedWindowStateFile(
  rawState: string,
): PersistedWindowStateFile | null {
  const parsedJson = JSON.parse(rawState);
  const parsedFile = persistedWindowStateFileSchema.safeParse(parsedJson);
  return parsedFile.success ? parsedFile.data : null;
}

function intersectionArea(args: IntersectingAreaArgs): number {
  const left = Math.max(args.bounds.x, args.workArea.x);
  const right = Math.min(
    args.bounds.x + args.bounds.width,
    args.workArea.x + args.workArea.width,
  );
  const top = Math.max(args.bounds.y, args.workArea.y);
  const bottom = Math.min(
    args.bounds.y + args.bounds.height,
    args.workArea.y + args.workArea.height,
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

function hasVisibleArea(args: HasVisibleAreaArgs): boolean {
  return args.displayWorkAreas.some(
    (workArea) =>
      intersectionArea({
        bounds: args.bounds,
        workArea,
      }) >= MIN_VISIBLE_AREA,
  );
}

export function restoreWindowState(
  args: RestoreWindowStateArgs,
): PersistedWindowState {
  if (args.persistedState === null) {
    return DEFAULT_WINDOW_STATE;
  }

  if (
    !hasVisibleArea({
      bounds: args.persistedState.bounds,
      displayWorkAreas: args.displayWorkAreas,
    })
  ) {
    return DEFAULT_WINDOW_STATE;
  }

  return args.persistedState;
}

export async function readPersistedWindowStateFile(
  args: ReadPersistedWindowStateFileArgs,
): Promise<PersistedWindowStateFile> {
  try {
    const rawState = await readFile(windowStatePath(args.userDataPath), "utf8");
    return parsePersistedWindowStateFile(rawState) ?? EMPTY_WINDOW_STATE_FILE;
  } catch {
    return EMPTY_WINDOW_STATE_FILE;
  }
}

export async function writePersistedWindowStateFile(
  args: WritePersistedWindowStateFileArgs,
): Promise<void> {
  await mkdir(args.userDataPath, { recursive: true });
  const path = windowStatePath(args.userDataPath);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(args.file, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function getDisplayWorkAreas(): DisplayWorkArea[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function browserWindowBounds(
  browserWindow: StatefulBrowserWindow,
): WindowBounds {
  const bounds = browserWindow.getNormalBounds();
  return {
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
}

export function restoreBrowserWindowState(
  args: RestoreBrowserWindowStateArgs,
): PersistedWindowState {
  const entry = args.windows.find(
    (candidate) => candidate.stateKey === args.stateKey,
  );
  return restoreWindowState({
    displayWorkAreas: args.displayWorkAreas ?? getDisplayWorkAreas(),
    persistedState:
      entry === undefined
        ? null
        : {
            bounds: entry.bounds,
            isFullScreen: entry.isFullScreen,
            isMaximized: entry.isMaximized,
          },
  });
}

export function createPersistedWindowStateEntry(
  args: CreatePersistedWindowStateEntryArgs,
): PersistedWindowStateEntry {
  return {
    bounds: browserWindowBounds(args.browserWindow),
    isFullScreen: args.browserWindow.isFullScreen(),
    isMaximized: args.browserWindow.isMaximized(),
    stateKey: args.stateKey,
  };
}
