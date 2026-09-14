export const LINUX_FRAMELESS_WINDOW_ARGUMENT = "--no-window-frame";
export const LINUX_TRANSPARENT_WINDOW_ARGUMENT = "--transparent-window";

interface HasLinuxWindowArgumentArgs {
  argument: string;
  argv: readonly string[];
  platform: NodeJS.Platform;
}

export function hasLinuxWindowArgument(
  args: HasLinuxWindowArgumentArgs,
): boolean {
  return args.platform === "linux" && args.argv.includes(args.argument);
}
