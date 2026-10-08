import { useEffect } from "react";
import {
  isWhatsNewVersionUnseen,
  recordWhatsNewBaseline,
  useWhatsNewSeenVersion,
} from "@/components/settings/whats-new-seen";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useSystemVersion } from "@/hooks/queries/system-queries";
import { defineSplit } from "@/lib/define-split";
import type { SidebarWhatsNewCardProps } from "./SidebarWhatsNewCard";

function Hidden() {
  return null;
}

const LazySidebarWhatsNewCard = defineSplit<SidebarWhatsNewCardProps>({
  id: "sidebar-whats-new",
  load: () =>
    import("./SidebarWhatsNewCard").then(
      (module) => module.SidebarWhatsNewCard,
    ),
  loading: Hidden,
  error: Hidden,
  tier: "intent",
});

export function SidebarWhatsNew({ onNavigate }: { onNavigate?: () => void }) {
  const { isCompactViewport, open } = useSidebar();
  const installedVersion = useSystemVersion().data?.currentVersion ?? null;
  const seenVersion = useWhatsNewSeenVersion();
  useEffect(() => {
    if (installedVersion !== null && seenVersion.length === 0) {
      recordWhatsNewBaseline(installedVersion);
    }
  }, [installedVersion, seenVersion]);
  if (
    (!isCompactViewport && !open) ||
    installedVersion === null ||
    !isWhatsNewVersionUnseen(seenVersion, installedVersion)
  ) {
    return null;
  }
  return (
    <LazySidebarWhatsNewCard
      installedVersion={installedVersion}
      seenVersion={seenVersion}
      onNavigate={onNavigate}
    />
  );
}
