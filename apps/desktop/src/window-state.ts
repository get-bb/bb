import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { screen } from "electron";
import { z } from "zod";
import {
  DEFAULT_WINDOW_STATE,
  type DefaultWindowState,
  type DisplayWorkArea,
  type PersistedWindowState,
  type WindowBounds,
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

export interface ReadPersistedWindowStateArgs {
  userDataPath: string;
}

export interface WritePersistedWindowStateArgs {
  state: PersistedWindowState;
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

export interface PersistBrowserWindowStateArgs {
  browserWindow: BrowserWindow;
  userDataPath: string;
}

export interface RestoreBrowserWindowStateArgs {
  userDataPath: string;
}

interface IntersectingAreaArgs {
  bounds: WindowBounds;
  workArea: DisplayWorkArea;
}

function windowStatePath(userDataPath: string): string {
  return join(userDataPath, WINDOW_STATE_FILE_NAME);
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
  try {
    const rawState = await readFile(windowStatePath(args.userDataPath), "utf8");
    const parsed = persistedWindowStateSchema.safeParse(JSON.parse(rawState));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writePersistedWindowState(
  args: WritePersistedWindowStateArgs,
): Promise<void> {
  await mkdir(args.userDataPath, { recursive: true });
  await writeFile(
    windowStatePath(args.userDataPath),
    `${JSON.stringify(args.state, null, 2)}\n`,
    "utf8",
  );
}

function getDisplayWorkAreas(): DisplayWorkArea[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function browserWindowBounds(browserWindow: BrowserWindow): WindowBounds {
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
    displayWorkAreas: getDisplayWorkAreas(),
    persistedState: await readPersistedWindowState({
      userDataPath: args.userDataPath,
    }),
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
    userDataPath: args.userDataPath,
  });
}
