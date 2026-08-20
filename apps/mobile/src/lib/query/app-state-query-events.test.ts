import { describe, expect, it } from "vitest";
import type { AppStateLike, AppStateStatusLike } from "../realtime/app-state";
import {
  installAppStateQueryEvents,
  type FocusManagerLike,
} from "./app-state-query-events";

function fakeAppState(initial: AppStateStatusLike) {
  const handlers = new Set<(state: AppStateStatusLike) => void>();
  const appState: AppStateLike & {
    emit(state: AppStateStatusLike): void;
    listeners(): number;
  } = {
    currentState: initial,
    addEventListener(_type, handler) {
      handlers.add(handler);
      return { remove: () => handlers.delete(handler) };
    },
    emit(state) {
      for (const handler of handlers) handler(state);
    },
    listeners: () => handlers.size,
  };
  return appState;
}

function fakeFocusManager() {
  const focusLog: (boolean | undefined)[] = [];
  let cleanup: (() => void) | null = null;
  const manager: FocusManagerLike & { focusLog: typeof focusLog } = {
    focusLog,
    setEventListener(setup) {
      cleanup?.();
      cleanup = setup((focused) => focusLog.push(focused));
    },
    setFocused(focused) {
      focusLog.push(focused);
    },
  };
  return manager;
}

describe("installAppStateQueryEvents", () => {
  it("seeds focus from the current state and follows active/background transitions only", () => {
    const appState = fakeAppState("background");
    const focusManager = fakeFocusManager();
    const uninstall = installAppStateQueryEvents({
      AppState: appState,
      focusManager,
    });
    expect(focusManager.focusLog).toEqual([false]);

    appState.emit("inactive");
    appState.emit("active");
    appState.emit("inactive");
    appState.emit("background");
    expect(focusManager.focusLog).toEqual([false, true, false]);

    uninstall();
    expect(appState.listeners()).toBe(0);
    appState.emit("active");
    expect(focusManager.focusLog).toEqual([false, true, false, true]);
  });
});
