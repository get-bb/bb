import { useCallback, useState } from "react";
import type {
  ExperimentalPageChrome,
  ExperimentalPageLocation,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import {
  getBbDesktopInfo,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { appToast } from "@/components/ui/app-toast";
import {
  usePageLocation,
  usePageOwner,
  type PageOwner,
} from "@/lib/page-owner";
import type { PluginPageSlot } from "@/lib/plugin-slots";
import { CORE_PAGE_PLUGIN_ID, CoreWorkspacePage } from "./core-pages";

const PAGE_SLOT_KIND = "page";
const PAGE_FRAME_CLASS =
  "relative -m-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-m-5";

function PageWindowBand({ chrome }: { chrome: ExperimentalPageChrome }) {
  const [desktopInfo] = useState(getBbDesktopInfo);
  if (
    chrome.sidebar !== "hidden" ||
    !shouldUseMacosDesktopChrome(desktopInfo)
  ) {
    return null;
  }
  return <AppPageHeader isWindowDragRegion ownsWindowTopLeft />;
}

interface PluginPageProps {
  slot: PluginPageSlot;
  location: ExperimentalPageLocation;
}

function PluginPage({ slot, location }: PluginPageProps) {
  const handleCrash = useCallback(
    (pluginId: string) => {
      appToast.error("Page plugin crashed", {
        description: `${slot.title} (${pluginId}) stopped working. bb's page is shown instead.`,
      });
    },
    [slot.title],
  );
  const Page = slot.component;
  return (
    <div className={PAGE_FRAME_CLASS} data-plugin-page={slot.pluginId}>
      <PageWindowBand chrome={slot.chrome} />
      <PluginSlotMount
        pluginId={slot.pluginId}
        slotKind={PAGE_SLOT_KIND}
        slotId={slot.id}
        crashFallback={<CoreWorkspacePage />}
        onCrash={handleCrash}
      >
        <Page location={location} />
      </PluginSlotMount>
    </div>
  );
}

function renderOwner(
  owner: PageOwner,
  location: ExperimentalPageLocation | null,
) {
  if (owner.kind === "pending") {
    return (
      <div className={PAGE_FRAME_CLASS} data-plugin-page-pending="">
        <PageWindowBand chrome={owner.chrome} />
      </div>
    );
  }
  if (owner.slot.pluginId === CORE_PAGE_PLUGIN_ID || location === null) {
    return <CoreWorkspacePage />;
  }
  return (
    <PluginPage
      key={`${owner.slot.pluginId}/${owner.slot.id}/${owner.slot.generation}`}
      slot={owner.slot}
      location={location}
    />
  );
}

export function PageRoute() {
  const location = usePageLocation();
  const owner = usePageOwner(location?.kind ?? null);
  return renderOwner(owner, location);
}
