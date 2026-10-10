import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export function useWindowReloadCommand(): void {
  const desktopApi = getBbDesktopInfo();
  const reloadWindow = desktopApi?.reloadWindow;

  useAppCommandHandler(
    "window.reload",
    () => {
      if (reloadWindow === undefined) {
        return false;
      }
      reloadWindow.call(desktopApi);
      return true;
    },
    0,
    reloadWindow !== undefined,
  );
}
