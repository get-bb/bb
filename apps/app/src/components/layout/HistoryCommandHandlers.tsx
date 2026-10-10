import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { useRouteStateHistoryNavigation } from "@/lib/app-route-history";

export function HistoryCommandHandlers() {
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();
  const closeOnMobile = useCloseMobileSidebar();

  useAppCommandHandler(
    "history.back",
    () => {
      goBack();
      closeOnMobile();
      return true;
    },
    0,
    true,
    () => canGoBack,
  );
  useAppCommandHandler(
    "history.forward",
    () => {
      goForward();
      closeOnMobile();
      return true;
    },
    0,
    true,
    () => canGoForward,
  );

  return null;
}
