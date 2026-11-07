import {
  useEffect,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ExperimentalBadge } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { experimentalBadgeSchema } from "@/lib/experimental-badge";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";

export type NavigationBadges = ReadonlyMap<string, ExperimentalBadge>;

type UseNavigationBadge = NonNullable<
  PluginNavPanelSlot["experimental_useBadge"]
>;

interface NavigationBadgeSourceProps {
  itemId: string;
  setBadges: Dispatch<SetStateAction<NavigationBadges>>;
}

const navigationBadgeSchema = experimentalBadgeSchema.nullable();

function sameBadge(
  left: ExperimentalBadge | undefined | null,
  right: ExperimentalBadge,
): boolean {
  return (
    left?.count === right.count &&
    left?.text === right.text &&
    (left?.tone ?? "neutral") === (right.tone ?? "neutral") &&
    left?.label === right.label
  );
}

function withBadge(
  badges: NavigationBadges,
  itemId: string,
  badge: ExperimentalBadge | null,
): NavigationBadges {
  const current = badges.get(itemId);
  if (badge === null) {
    if (current === undefined) return badges;
    const next = new Map(badges);
    next.delete(itemId);
    return next;
  }
  if (sameBadge(current, badge)) return badges;
  return new Map(badges).set(itemId, badge);
}

const navigationBadgeSources = new WeakMap<
  UseNavigationBadge,
  ComponentType<NavigationBadgeSourceProps>
>();

function navigationBadgeSource(
  useNavigationBadge: UseNavigationBadge,
): ComponentType<NavigationBadgeSourceProps> {
  const cached = navigationBadgeSources.get(useNavigationBadge);
  if (cached) return cached;
  function NavigationBadgeSource({
    itemId,
    setBadges,
  }: NavigationBadgeSourceProps) {
    const parsed = navigationBadgeSchema.safeParse(useNavigationBadge());
    if (!parsed.success) {
      throw new Error(
        `experimental_useBadge returned an invalid badge: ${parsed.error.message}`,
      );
    }
    const count = parsed.data?.count;
    const text = parsed.data?.text;
    const tone = parsed.data?.tone;
    const label = parsed.data?.label;
    useEffect(() => {
      setBadges((badges) =>
        withBadge(
          badges,
          itemId,
          label === undefined
            ? null
            : {
                ...(count === undefined ? {} : { count }),
                ...(text === undefined ? {} : { text }),
                ...(tone === undefined ? {} : { tone }),
                label,
              },
        ),
      );
      return () => setBadges((badges) => withBadge(badges, itemId, null));
    }, [count, itemId, label, setBadges, text, tone]);
    return null;
  }
  navigationBadgeSources.set(useNavigationBadge, NavigationBadgeSource);
  return NavigationBadgeSource;
}

export function NavigationBadgeSources({
  panels,
  setBadges,
}: {
  panels: readonly { itemId: string; panel: PluginNavPanelSlot }[];
  setBadges: Dispatch<SetStateAction<NavigationBadges>>;
}) {
  return panels.map(({ itemId, panel }) => {
    const useNavigationBadge = panel.experimental_useBadge;
    if (useNavigationBadge === undefined) return null;
    const Source = navigationBadgeSource(useNavigationBadge);
    return (
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
        pluginId={panel.pluginId}
        slotKind="navPanelBadge"
        slotId={panel.id}
        crashFallback={null}
      >
        <Source itemId={itemId} setBadges={setBadges} />
      </PluginSlotMount>
    );
  });
}
