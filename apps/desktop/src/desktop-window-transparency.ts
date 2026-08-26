export const LINUX_TRANSPARENT_WINDOW_ARGUMENT = "--transparent-window";

interface ShouldUseLinuxTransparentWindowArgs {
  argv: readonly string[];
  platform: NodeJS.Platform;
}

export function shouldUseLinuxTransparentWindow(
  args: ShouldUseLinuxTransparentWindowArgs,
): boolean {
  return (
    args.platform === "linux" &&
    args.argv.includes(LINUX_TRANSPARENT_WINDOW_ARGUMENT)
  );
}
