export interface DesktopSessionHttpCache {
  clearCache(): Promise<void>;
}

export interface ClearPackagedSessionHttpCacheArgs {
  isPackaged: boolean;
  session: DesktopSessionHttpCache;
}

export async function clearPackagedSessionHttpCache(
  args: ClearPackagedSessionHttpCacheArgs,
): Promise<void> {
  if (!args.isPackaged) {
    return;
  }

  await args.session.clearCache();
}
