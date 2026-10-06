export interface PackagedAppLaunchArgumentsArgs {
  platform: NodeJS.Platform;
  userDataDir: string;
}

export function createPackagedAppLaunchArguments(
  args: PackagedAppLaunchArgumentsArgs,
): string[];
