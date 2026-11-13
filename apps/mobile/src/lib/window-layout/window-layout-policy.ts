import {
  shellWindowLayoutSchema,
  type ShellWindowLayout,
} from "@bb/mobile-bridge";

export type StatusBarPlacement = "system" | "top";

export const STATUS_BAR_PLACEMENT_STORAGE_KEY = "bb.statusBar.placement";

export function parseStatusBarPlacement(
  stored: string | undefined,
): StatusBarPlacement {
  return stored === "top" ? "top" : "system";
}

export interface StatusBarPreferenceStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface StatusBarPreferenceStore {
  placement(): StatusBarPlacement;
  setPlacement(next: StatusBarPlacement): void;
  subscribe(listener: () => void): () => void;
}

export function createStatusBarPreferenceStore(
  storage: StatusBarPreferenceStorage,
): StatusBarPreferenceStore {
  const listeners = new Set<() => void>();
  let placement = parseStatusBarPlacement(
    storage.getString(STATUS_BAR_PLACEMENT_STORAGE_KEY),
  );
  return {
    placement: () => placement,
    setPlacement: (next) => {
      if (next === placement) return;
      placement = next;
      storage.set(STATUS_BAR_PLACEMENT_STORAGE_KEY, next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function parseNativeWindowLayout(
  payload: unknown,
): ShellWindowLayout | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { verticalBarEdge, verticalBarBehavior, occlusions } = payload as {
    verticalBarEdge?: unknown;
    verticalBarBehavior?: unknown;
    occlusions?: unknown;
  };
  const parsed = shellWindowLayoutSchema.safeParse({
    verticalBar: { edge: verticalBarEdge, behavior: verticalBarBehavior },
    occlusions,
  });
  return parsed.success ? parsed.data : null;
}

export function windowLayoutKey(layout: ShellWindowLayout | null): string {
  return layout === null ? "" : JSON.stringify(layout);
}

export function showsStatusBarSetting(input: {
  platform: string;
  placement: StatusBarPlacement;
  layout: ShellWindowLayout | null;
}): boolean {
  if (input.platform !== "ios") return false;
  if (input.placement === "top") return true;
  return input.layout !== null && input.layout.verticalBar.edge !== "none";
}
