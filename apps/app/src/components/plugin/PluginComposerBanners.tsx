import { useMemo, type ReactNode } from "react";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { useResolvedComposerBanners } from "./composer-slot-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  useOptionalPluginComposerStaticView,
} from "./plugin-composer-host";

export function ComposerBannersSlot({
  children,
  ownerPlacement = "after",
}: {
  children?: ReactNode;
  ownerPlacement?: "before" | "after";
}) {
  return (
    <ComposerBannerRows ownerPlacement={ownerPlacement}>
      {children}
    </ComposerBannerRows>
  );
}

function ComposerBannerRows({
  children,
  ownerPlacement,
}: {
  children?: ReactNode;
  ownerPlacement: "before" | "after";
}) {
  const view = useOptionalPluginComposerStaticView();
  const banners = useResolvedComposerBanners(view?.scope.kind ?? null);
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
