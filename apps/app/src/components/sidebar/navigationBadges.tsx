import {
  useEffect,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import { z } from "zod";
import type { ExperimentalBadge } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";

export type NavigationBadges = ReadonlyMap<string, ExperimentalBadge>;

type UseNavigationBadge = NonNullable<
  PluginNavPanelSlot["experimental_useBadge"]
>;

interface NavigationBadgeSourceProps {
  itemId: string;
  setBadges: Dispatch<SetStateAction<NavigationBadges>>;
}

const RAIL_MAX_DRAWN_COUNT = 9;
const LIST_MAX_DRAWN_COUNT = 99;

const navigationBadgeSchema = z
  .object({
    count: z.number().int().positive().optional(),
    label: z.string().trim().min(1),
  })
  .strict()
  .nullable();

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
  if (current?.count === badge.count && current?.label === badge.label) {
    return badges;
  }
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
    const label = parsed.data?.label;
    useEffect(() => {
      setBadges((badges) =>
        withBadge(
          badges,
          itemId,
          label === undefined
            ? null
            : { ...(count === undefined ? {} : { count }), label },
        ),
      );
      return () => setBadges((badges) => withBadge(badges, itemId, null));
    }, [count, itemId, label, setBadges]);
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

export function navigationBadgeAccessibleLabel(
  label: string,
  badge: ExperimentalBadge | null,
): string {
  return badge === null ? label : `${label}, ${badge.label}`;
}

export function hiddenNavigationBadgeLabels(
  hidden: readonly { label: string; badge: ExperimentalBadge | null }[],
): string[] {
  return hidden.flatMap((item) =>
    item.badge ? [`${item.label}: ${item.badge.label}`] : [],
  );
}

export function NavigationBadgeMark({
  count,
  size = "rail",
  className,
}: {
  count: number | undefined;
  size?: "rail" | "list";
  className?: string;
}) {
  if (count === undefined) {
    return (
      <span
        aria-hidden="true"
        data-nav-rail-badge="dot"
        className={cn("size-1.5 shrink-0 rounded-full bg-primary", className)}
      />
    );
  }
  const max = size === "rail" ? RAIL_MAX_DRAWN_COUNT : LIST_MAX_DRAWN_COUNT;
  return (
    <span
      aria-hidden="true"
      data-nav-rail-badge="count"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary font-medium leading-none tabular-nums text-primary-foreground",
        size === "rail"
          ? "h-3 min-w-3 px-0.5 text-2xs"
          : "h-4 min-w-4 px-1 text-2xs",
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
