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
  zoomFactor: z
    .number()
    .min(BB_DESKTOP_MIN_ZOOM_PERCENT / 100)
    .max(BB_DESKTOP_MAX_ZOOM_PERCENT / 100)
    .catch(1),
  isFullScreen: z.boolean(),
  isMaximized: z.boolean(),
});

const persistedWindowStateEntrySchema = persistedWindowStateSchema.extend({
  stateKey: z.string().min(1),
});

const persistedWindowStateFileSchema = z.object({
  windows: z.array(persistedWindowStateEntrySchema),
});

interface ReadPersistedWindowStateArgs {
  stateKey: WindowStateKey;
  userDataPath: string;
}

interface ReadPersistedWindowStateEntriesArgs {
  userDataPath: string;
}

interface WritePersistedWindowStateEntriesArgs {
  entries: PersistedWindowStateEntry[];
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
  webContents: { getZoomFactor(): number };
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
}

interface RestoreBrowserWindowStateArgs {
  displayWorkAreas: DisplayWorkArea[] | null;
  stateKey: WindowStateKey;
  userDataPath: string;
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

export async function readPersistedWindowState(
  args: ReadPersistedWindowStateArgs,
): Promise<PersistedWindowState | null> {
  const entries = await readPersistedWindowStateEntries({
    userDataPath: args.userDataPath,
  });
  const entry = entries.find(
    (candidate) => candidate.stateKey === args.stateKey,
  );
  if (entry === undefined) {
    return null;
  }
  return {
    bounds: entry.bounds,
    zoomFactor: entry.zoomFactor,
    isFullScreen: entry.isFullScreen,
    isMaximized: entry.isMaximized,
  };
}

export async function readPersistedWindowStateEntries(
  args: ReadPersistedWindowStateEntriesArgs,
): Promise<PersistedWindowStateEntry[]> {
  try {
    const rawState = await readFile(windowStatePath(args.userDataPath), "utf8");
    const parsed = parsePersistedWindowStateFile(rawState);
    return parsed === null ? [] : parsed.windows;
  } catch {
    return [];
  }
}

export async function writePersistedWindowStateEntries(
  args: WritePersistedWindowStateEntriesArgs,
): Promise<void> {
  await mkdir(args.userDataPath, { recursive: true });
  const path = windowStatePath(args.userDataPath);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ windows: args.entries }, null, 2)}\n`,
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

export async function restoreBrowserWindowState(
  args: RestoreBrowserWindowStateArgs,
): Promise<PersistedWindowState> {
  return restoreWindowState({
    displayWorkAreas: args.displayWorkAreas ?? getDisplayWorkAreas(),
    persistedState: await readPersistedWindowState({
      stateKey: args.stateKey,
      userDataPath: args.userDataPath,
    }),
  });
}

export function createPersistedWindowStateEntry(
  args: CreatePersistedWindowStateEntryArgs,
): PersistedWindowStateEntry {
  return {
    bounds: browserWindowBounds(args.browserWindow),
    zoomFactor: args.browserWindow.webContents.getZoomFactor(),
    isFullScreen: args.browserWindow.isFullScreen(),
    isMaximized: args.browserWindow.isMaximized(),
    stateKey: args.stateKey,
  };
}
