import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { useRouteStateHistoryNavigation } from "@/lib/app-route-history";

export function HistoryCommandHandlers() {
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();
  const closeOnMobile = useCloseMobileSidebar();

  useAppCommandHandler("history.back", () => {
    if (!canGoBack) return false;
    goBack();
    closeOnMobile();
    return true;
  });
  useAppCommandHandler("history.forward", () => {
    if (!canGoForward) return false;
    goForward();
    closeOnMobile();
    return true;
  });

  return null;
}
