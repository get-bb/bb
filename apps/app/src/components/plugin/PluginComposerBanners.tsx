import type { ReactNode } from "react";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { useResolvedComposerBanners } from "./composer-slot-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  PluginComposerViewProvider,
  useOptionalPluginComposerView,
} from "./plugin-composer-host";

/** All preservable banner rows for one Composer instance. */
export function ComposerBannersSlot({
  view,
  children,
  ownerPlacement = "after",
  includePluginContributions = true,
}: {
  view?: ComposerView;
  children?: ReactNode;
  ownerPlacement?: "before" | "after";
  includePluginContributions?: boolean;
}) {
  return view === undefined ? (
    <ComposerBannerRows
      ownerPlacement={ownerPlacement}
      includePluginContributions={includePluginContributions}
    >
      {children}
    </ComposerBannerRows>
  ) : (
    <PluginComposerViewProvider value={view}>
      <ComposerBannerRows
        ownerPlacement={ownerPlacement}
        includePluginContributions={includePluginContributions}
      >
        {children}
      </ComposerBannerRows>
    </PluginComposerViewProvider>
  );
}

function ComposerBannerRows({
  children,
  ownerPlacement,
  includePluginContributions,
}: {
  children?: ReactNode;
  ownerPlacement: "before" | "after";
  includePluginContributions: boolean;
}) {
  const view = useOptionalPluginComposerView();
  const banners = useResolvedComposerBanners(view?.scope.kind ?? null);
  const scopeKey =
    view === undefined ? null : composerScopeIdentity(view.scope);
  const pluginRows = (includePluginContributions ? banners : []).map(
    ({ key, pluginId, customizationId, banner }) => {
      const slotId = `${customizationId}/${banner.id}`;
      return (
        <PluginSlotMount
          key={`${key}/${scopeKey ?? "unbound"}`}
          pluginId={pluginId}
          slotKind="composerBanner"
          slotId={slotId}
          crashFallback={<></>}
        >
          {banner.chrome === "bare" ? (
            <banner.component />
          ) : (
            <PromptStackCard ariaLabel={pluginId} className="empty:hidden">
              <banner.component />
            </PromptStackCard>
          )}
        </PluginSlotMount>
      );
    },
  );

  return (
    <>
      {ownerPlacement === "before" ? children : null}
      {pluginRows}
      {ownerPlacement === "after" ? children : null}
    </>
  );
}
