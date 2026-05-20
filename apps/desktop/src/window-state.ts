import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { screen } from "electron";
import { z } from "zod";
import {
  DEFAULT_WINDOW_STATE,
  PRIMARY_WINDOW_STATE_KEY,
  type DefaultWindowState,
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
});

export interface ReadPersistedWindowStateArgs {
  stateKey: WindowStateKey;
  userDataPath: string;
}

export interface ReadPersistedWindowStateEntriesArgs {
  userDataPath: string;
}

export interface WritePersistedWindowStateArgs {
  state: PersistedWindowState;
  stateKey: WindowStateKey;
  userDataPath: string;
}

export interface WritePersistedWindowStateEntriesArgs {
  entries: PersistedWindowStateEntry[];
  userDataPath: string;
}

export interface RestoreWindowStateArgs {
  defaultState?: DefaultWindowState;
  displayWorkAreas: DisplayWorkArea[];
  persistedState: PersistedWindowState | null;
}

export interface HasVisibleAreaArgs {
  bounds: WindowBounds;
  displayWorkAreas: DisplayWorkArea[];
}

export interface StatefulBrowserWindow {
  getBounds(): WindowBounds;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
}

export interface PersistBrowserWindowStateArgs {
  browserWindow: StatefulBrowserWindow;
  stateKey: WindowStateKey;
  userDataPath: string;
}

export interface PersistBrowserWindowStateSnapshot {
  browserWindow: StatefulBrowserWindow;
  stateKey: WindowStateKey;
}

export interface PersistBrowserWindowStatesArgs {
  snapshots: PersistBrowserWindowStateSnapshot[];
  userDataPath: string;
}

export interface RestoreBrowserWindowStateArgs {
  displayWorkAreas: DisplayWorkArea[] | null;
  stateKey: WindowStateKey;
  userDataPath: string;
}

export interface RemovePersistedWindowStateArgs {
  stateKey: WindowStateKey;
  userDataPath: string;
}

export interface UpsertPersistedWindowStateEntryArgs {
  entries: PersistedWindowStateEntry[];
  entry: PersistedWindowStateEntry;
}

export interface RemovePersistedWindowStateEntryArgs {
  entries: PersistedWindowStateEntry[];
  stateKey: WindowStateKey;
}

export interface CreatePersistedWindowStateEntryArgs {
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
  if (parsedFile.success) {
    return parsedFile.data;
  }

  const parsedLegacyState = persistedWindowStateSchema.safeParse(parsedJson);
  if (!parsedLegacyState.success) {
    return null;
  }

  return {
    windows: [
      {
        ...parsedLegacyState.data,
        stateKey: PRIMARY_WINDOW_STATE_KEY,
      },
    ],
  };
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

export function hasVisibleArea(args: HasVisibleAreaArgs): boolean {
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
): DefaultWindowState {
  const defaultState = args.defaultState ?? DEFAULT_WINDOW_STATE;
  if (args.persistedState === null) {
    return defaultState;
  }

  if (
    !hasVisibleArea({
      bounds: args.persistedState.bounds,
      displayWorkAreas: args.displayWorkAreas,
    })
  ) {
    return defaultState;
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

export async function writePersistedWindowState(
  args: WritePersistedWindowStateArgs,
): Promise<void> {
  const entries = await readPersistedWindowStateEntries({
    userDataPath: args.userDataPath,
  });
  await writePersistedWindowStateEntries({
    entries: upsertPersistedWindowStateEntry({
      entries,
      entry: {
        ...args.state,
        stateKey: args.stateKey,
      },
    }),
    userDataPath: args.userDataPath,
  });
}

export async function writePersistedWindowStateEntries(
  args: WritePersistedWindowStateEntriesArgs,
): Promise<void> {
  await mkdir(args.userDataPath, { recursive: true });
  await writeFile(
    windowStatePath(args.userDataPath),
    `${JSON.stringify({ windows: args.entries }, null, 2)}\n`,
    "utf8",
  );
}

function getDisplayWorkAreas(): DisplayWorkArea[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function browserWindowBounds(
  browserWindow: StatefulBrowserWindow,
): WindowBounds {
  const bounds = browserWindow.getBounds();
  return {
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
}

export async function restoreBrowserWindowState(
  args: RestoreBrowserWindowStateArgs,
): Promise<DefaultWindowState> {
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
    isFullScreen: args.browserWindow.isFullScreen(),
    isMaximized: args.browserWindow.isMaximized(),
    stateKey: args.stateKey,
  };
}

export function upsertPersistedWindowStateEntry(
  args: UpsertPersistedWindowStateEntryArgs,
): PersistedWindowStateEntry[] {
  const entries: PersistedWindowStateEntry[] = [];
  let replaced = false;

  for (const entry of args.entries) {
    if (entry.stateKey === args.entry.stateKey) {
      if (!replaced) {
        entries.push(args.entry);
        replaced = true;
      }
    } else {
      entries.push(entry);
    }
  }

  if (!replaced) {
    entries.push(args.entry);
  }

  return entries;
}

export function removePersistedWindowStateEntry(
  args: RemovePersistedWindowStateEntryArgs,
): PersistedWindowStateEntry[] {
  const entries: PersistedWindowStateEntry[] = [];
  for (const entry of args.entries) {
    if (entry.stateKey !== args.stateKey) {
      entries.push(entry);
    }
  }
  return entries;
}

export async function removePersistedWindowState(
  args: RemovePersistedWindowStateArgs,
): Promise<void> {
  const entries = await readPersistedWindowStateEntries({
    userDataPath: args.userDataPath,
  });
  await writePersistedWindowStateEntries({
    entries: removePersistedWindowStateEntry({
      entries,
      stateKey: args.stateKey,
    }),
    userDataPath: args.userDataPath,
  });
}

export async function persistBrowserWindowState(
  args: PersistBrowserWindowStateArgs,
): Promise<void> {
  if (args.browserWindow.isDestroyed()) {
    return;
  }

  await writePersistedWindowState({
    state: {
      bounds: browserWindowBounds(args.browserWindow),
      isFullScreen: args.browserWindow.isFullScreen(),
      isMaximized: args.browserWindow.isMaximized(),
    },
    stateKey: args.stateKey,
    userDataPath: args.userDataPath,
  });
}

export async function persistBrowserWindowStates(
  args: PersistBrowserWindowStatesArgs,
): Promise<void> {
  const entries: PersistedWindowStateEntry[] = [];
  for (const snapshot of args.snapshots) {
    if (!snapshot.browserWindow.isDestroyed()) {
      entries.push(
        createPersistedWindowStateEntry({
          browserWindow: snapshot.browserWindow,
          stateKey: snapshot.stateKey,
        }),
      );
    }
  }

  await writePersistedWindowStateEntries({
    entries,
    userDataPath: args.userDataPath,
  });
}
