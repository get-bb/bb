export const DEFAULT_BB_SERVER_PORT = 38886;
export const DEFAULT_BB_SERVER_URL = `http://127.0.0.1:${DEFAULT_BB_SERVER_PORT}`;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const DEFAULT_WINDOW_WIDTH = 1280;
export const MIN_WINDOW_HEIGHT = 700;
export const MIN_WINDOW_WIDTH = 1024;
export const STARTUP_POLL_INTERVAL_MS = 250;
export const STARTUP_TIMEOUT_MS = 60_000;
export const ATTACH_PROBE_TIMEOUT_MS = 1_500;
export const PROCESS_LOG_LINE_LIMIT = 200;

export type RuntimeOwnership = "attached" | "spawned";
export type WindowStateKey = string;

export const PRIMARY_WINDOW_STATE_KEY = "main";

export interface WindowBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface PersistedWindowState {
  bounds: WindowBounds;
  isFullScreen: boolean;
  isMaximized: boolean;
}

export interface PersistedWindowStateEntry extends PersistedWindowState {
  stateKey: WindowStateKey;
}

export interface PersistedWindowStateFile {
  windows: PersistedWindowStateEntry[];
}

export interface DisplayWorkArea {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface DefaultWindowState {
  bounds: WindowBounds;
  isFullScreen: boolean;
  isMaximized: boolean;
}

export const DEFAULT_WINDOW_STATE: DefaultWindowState = {
  bounds: {
    height: DEFAULT_WINDOW_HEIGHT,
    width: DEFAULT_WINDOW_WIDTH,
    x: 80,
    y: 80,
  },
  isFullScreen: false,
  isMaximized: false,
};
