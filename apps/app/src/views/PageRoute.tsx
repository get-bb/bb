import { useCallback } from "react";
import type { ExperimentalPageLocation } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
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
    return <div className={PAGE_FRAME_CLASS} data-plugin-page-pending="" />;
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
