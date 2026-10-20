export function importTerminalModules() {
  return Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-unicode11"),
  ]);
}

export function importTerminalWebglAddon() {
  return import("@xterm/addon-webgl");
}

export function preloadTerminalModules(): void {
  void importTerminalModules().catch(() => undefined);
  void importTerminalWebglAddon().catch(() => undefined);
}
