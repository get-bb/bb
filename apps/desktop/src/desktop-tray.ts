interface ShouldQuitOnWindowAllClosedArgs {
  platform: NodeJS.Platform;
}

interface ShouldCreateTrayIconArgs {
  platform: NodeJS.Platform;
}

export interface DesktopTrayHandle {
  destroy(): void;
  on(event: "click", listener: () => void): void;
  setContextMenu(menu: unknown): void;
  setToolTip(tooltip: string): void;
}

export interface DesktopTrayMenuArgs {
  onQuit(): void;
  onShow(): void;
}

export interface DesktopTrayDeps {
  buildMenu(args: DesktopTrayMenuArgs): unknown;
  createIcon(imagePath: string): DesktopTrayHandle;
}

interface CreateDesktopTrayArgs {
  deps: DesktopTrayDeps;
  iconPath: string;
  onQuit(): void;
  onShow(): void;
  platform: NodeJS.Platform;
}

export const DESKTOP_TRAY_TOOLTIP = "bb";

export function shouldQuitOnWindowAllClosed(
  args: ShouldQuitOnWindowAllClosedArgs,
): boolean {
  return args.platform !== "darwin" && args.platform !== "win32";
}

export function shouldCreateTrayIcon(
  args: ShouldCreateTrayIconArgs,
): boolean {
  return args.platform === "win32";
}

export function createDesktopTray(
  args: CreateDesktopTrayArgs,
): DesktopTrayHandle | null {
  if (!shouldCreateTrayIcon({ platform: args.platform })) {
    return null;
  }
  const tray = args.deps.createIcon(args.iconPath);
  tray.setToolTip(DESKTOP_TRAY_TOOLTIP);
  tray.setContextMenu(
    args.deps.buildMenu({ onQuit: args.onQuit, onShow: args.onShow }),
  );
  tray.on("click", args.onShow);
  return tray;
}
