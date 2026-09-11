import {
  Component,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ExperimentalProviderIconProps } from "@get-bb/plugin-sdk/app";
import { isPresentationTintColor } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";

const ProviderIconAncestors = createContext<readonly string[]>([]);

class ProviderIconErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ProviderIcon({
  provider,
  fallback = "Code",
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: ExperimentalProviderIconProps) {
  "use no memo";
  const { id: providerId, logoUrl, icon } = provider;
  const glyph = typeof icon === "string" ? icon : icon?.glyph;
  const tint = provider.strings?.iconTint;
  const ancestors = useContext(ProviderIconAncestors);
  const slot = useSyncExternalStore(
    subscribePluginSlots,
    () =>
      getPluginSlotSnapshot().providerIcons.find(
        (entry) => entry.providerId === providerId,
      ),
    () => undefined,
  );
  const image =
    logoUrl == null
      ? undefined
      : `url("${logoUrl.replace(/["\\]/gu, "\\$&")}")`;
  const declared =
    image === undefined ? (
      <Icon
        name={glyph ?? fallback}
        fallback={fallback}
        className="size-full"
        aria-hidden="true"
      />
    ) : (
      <span
        data-provider-logo={logoUrl}
        className="inline-block size-full shrink-0 bg-current"
        style={{
          maskImage: image,
          WebkitMaskImage: image,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
          maskSize: "contain",
          WebkitMaskSize: "contain",
        }}
      />
    );
  const CustomIcon = slot?.icon;
  return (
    <span
      className={cn("inline-flex size-6 shrink-0", className)}
      style={
        tint != null &&
        isPresentationTintColor(tint.light) &&
        isPresentationTintColor(tint.dark)
          ? { color: `light-dark(${tint.light.trim()}, ${tint.dark.trim()})` }
          : undefined
      }
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
    >
      {slot !== undefined &&
      CustomIcon !== undefined &&
      !ancestors.includes(providerId) ? (
        <ProviderIconAncestors.Provider value={[...ancestors, providerId]}>
          <ProviderIconErrorBoundary
            key={`${slot.pluginId}:${slot.generation}:${providerId}`}
            fallback={declared}
          >
            <CustomIcon className="size-full" />
          </ProviderIconErrorBoundary>
        </ProviderIconAncestors.Provider>
      ) : (
        declared
      )}
    </span>
  );
}
