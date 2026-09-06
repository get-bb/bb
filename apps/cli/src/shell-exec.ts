interface ResolveShellExecOptionsArgs {
  platform?: NodeJS.Platform;
}

export function resolveShellExecOptions(
  args: ResolveShellExecOptionsArgs = {},
): { shell: true } | Record<string, never> {
  const platform = args.platform ?? process.platform;
  if (platform === "win32") {
    return { shell: true };
  }
  return {};
}
