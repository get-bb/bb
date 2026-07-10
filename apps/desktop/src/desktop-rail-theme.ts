import type {
  BbDesktopTheme,
  BbDesktopThemeMode,
  BbDesktopThemeResolved,
} from "@bb/desktop-contract";

/**
 * Default --canvas/--ink when only a legacy "light"|"dark" string arrives
 * (older SPA) or colors are missing. Matches apps/app theme.css anchors.
 */
export const DEFAULT_RAIL_THEME_LIGHT: BbDesktopThemeResolved = {
  canvasColor: "oklch(1 0 0)",
  inkColor: "oklch(0.3211 0 0)",
  mode: "light",
};

export const DEFAULT_RAIL_THEME_DARK: BbDesktopThemeResolved = {
  canvasColor: "oklch(0.195 0 0)",
  inkColor: "oklch(0.81 0 0)",
  mode: "dark",
};

export function defaultRailThemeForMode(
  mode: BbDesktopThemeMode,
): BbDesktopThemeResolved {
  return mode === "dark" ? DEFAULT_RAIL_THEME_DARK : DEFAULT_RAIL_THEME_LIGHT;
}

/**
 * Normalize a setTheme IPC payload into a fully resolved rail theme.
 * Legacy string payloads get default anchors; object payloads pass through.
 */
export function resolveRailTheme(payload: BbDesktopTheme): BbDesktopThemeResolved {
  if (typeof payload === "string") {
    return defaultRailThemeForMode(payload);
  }
  const canvasColor = payload.canvasColor.trim();
  const inkColor = payload.inkColor.trim();
  if (canvasColor.length === 0 || inkColor.length === 0) {
    return defaultRailThemeForMode(payload.mode);
  }
  return {
    canvasColor,
    inkColor,
    mode: payload.mode,
  };
}

export function themeModeFromPayload(payload: BbDesktopTheme): BbDesktopThemeMode {
  return typeof payload === "string" ? payload : payload.mode;
}
