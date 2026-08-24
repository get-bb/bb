import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";

/**
 * Registers `logs.openServerDaemon` only while the desktop shell can actually
 * show the log viewer. Registration is the palette's availability gate, so an
 * unregistered command means no row — which is what the web build, a Linux
 * shell, and an attached runtime all want. A row that opened nothing would be
 * worse than no row at all.
 */
export function useServerDaemonLogsCommand(): void {
  const { desktopApi, desktopInfo } = useDesktopUpdateInfo();
  const openLogs = desktopApi?.openServerDaemonLogs;
  const enabled =
    openLogs !== undefined && desktopInfo?.serverDaemonLogsAvailable === true;

  useAppCommandHandler(
    "logs.openServerDaemon",
    () => {
      if (openLogs === undefined) {
        return false;
      }
      // Fire-and-forget: main owns focusing an already-open viewer, and the
      // palette has already closed by the time this resolves.
      void openLogs.call(desktopApi).catch(() => undefined);
      return true;
    },
    0,
    enabled,
  );
}
