import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export function useDataDirectoryCommand(): void {
  const desktopApi = getBbDesktopInfo();
  const openDataDirectory = desktopApi?.openDataDirectory;

  useAppCommandHandler(
    "dataDirectory.open",
    () => {
      if (openDataDirectory === undefined) {
        return false;
      }
      void openDataDirectory.call(desktopApi).catch(() => undefined);
      return true;
    },
    0,
    openDataDirectory !== undefined,
  );
}
