export const LINUX_FRAMELESS_WINDOW_ARGUMENT = "--no-window-frame";

interface ShouldUseLinuxFramelessWindowArgs {
  argv: readonly string[];
  platform: NodeJS.Platform;
}

export function shouldUseLinuxFramelessWindow(
  args: ShouldUseLinuxFramelessWindowArgs,
): boolean {
  return (
    args.platform === "linux" &&
    args.argv.includes(LINUX_FRAMELESS_WINDOW_ARGUMENT)
  );
}
