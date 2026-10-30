import { useMemo, type ReactNode } from "react";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { useResolvedComposerBanners } from "./composer-slot-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  PluginComposerViewProvider,
  useOptionalPluginComposerStaticView,
} from "./plugin-composer-host";

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
  const view = useOptionalPluginComposerStaticView();
  const banners = useResolvedComposerBanners(
    includePluginContributions ? (view?.scope.kind ?? null) : null,
  );
  const scopeKey =
    view === undefined ? null : composerScopeIdentity(view.scope);
  const pluginRows = useMemo(
    () =>
      banners.map(({ key, pluginId, customizationId, banner }) => {
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
      }),
    [banners, scopeKey],
  );

  return (
    <>
      {ownerPlacement === "before" ? children : null}
      {pluginRows}
      {ownerPlacement === "after" ? children : null}
    </>
  );
}
