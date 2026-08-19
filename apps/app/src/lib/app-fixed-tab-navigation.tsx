import { createContext, useContext, type ReactNode } from "react";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type {
  AppFixedTabOpenIntent,
  AppFixedTabReference,
} from "@/lib/app-navigation-host";

export interface AppFixedTabDestination {
  open(target: JsonValue | undefined): boolean;
  tab: AppFixedTabReference;
}

export function getPluginFixedTabOwnerId(
  pluginId: string,
  panelId: string,
): string {
  return `plugin:${pluginId}:${panelId}`;
}

/**
 * Generic fixed-tab transition. Destination owners validate and interpret
 * targets; this controller only resolves an owner-scoped reference.
 */
export function openAppFixedTabFromDestinations(
  destinations: readonly AppFixedTabDestination[],
  intent: AppFixedTabOpenIntent,
): boolean {
  const destination = destinations.find(
    (candidate) =>
      candidate.tab.ownerId === intent.tab.ownerId &&
      candidate.tab.tabId === intent.tab.tabId,
  );
  return destination?.open(intent.target) ?? false;
}

export interface AppFixedTabTargetDelivery {
  consume(): void;
  ownerId: string;
  sequence: number;
  tabId: string;
  target: JsonValue;
}

const AppFixedTabTargetContext =
  createContext<AppFixedTabTargetDelivery | null>(null);

export function AppFixedTabTargetProvider({
  children,
  delivery,
}: {
  children: ReactNode;
  delivery: AppFixedTabTargetDelivery | null;
}) {
  return (
    <AppFixedTabTargetContext.Provider value={delivery}>
      {children}
    </AppFixedTabTargetContext.Provider>
  );
}

export function useAppFixedTabTarget(
  ownerId: string,
  tabId: string,
): AppFixedTabTargetDelivery | null {
  const delivery = useContext(AppFixedTabTargetContext);
  return delivery?.ownerId === ownerId && delivery.tabId === tabId
    ? delivery
    : null;
}
