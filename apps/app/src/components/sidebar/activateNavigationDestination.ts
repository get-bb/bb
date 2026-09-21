import { getBbDesktopInfo } from "@/lib/bb-desktop";

export function activateNavigationDestination({
  event,
  path,
  navigate,
  openInSplit,
}: {
  event: { metaKey: boolean; ctrlKey: boolean };
  path: string;
  navigate: () => void;
  openInSplit: () => void;
}): void {
  if (!event.metaKey && !event.ctrlKey) {
    navigate();
  } else if (getBbDesktopInfo() !== null) {
    openInSplit();
  } else {
    window.open(path, "_blank", "noopener");
  }
}
