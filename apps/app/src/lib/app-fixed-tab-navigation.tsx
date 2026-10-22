import { createContext, useContext, type ReactNode } from "react";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { jsonValueSchema } from "@bb/domain";
import type {
  AppFixedTabOpenIntent,
  AppTabOpenIntent,
  AppFixedTabReference,
} from "@/lib/app-navigation-host";

export interface AppFixedTabDestination {
  availability?: "fixed" | "action";
  open(
    target: JsonValue | undefined,
    options?: { params?: JsonValue; title?: string },
  ): boolean;
  tab: AppFixedTabReference;
}

export function getPluginFixedTabOwnerId(
  pluginId: string,
  panelId: string,
): string {
  return `plugin:${pluginId}:${panelId}`;
}

export function getThreadFixedTabOwnerId(pluginId: string): string {
  return `plugin-thread:${pluginId}`;
}

export function openAppFixedTabFromDestinations(
  destinations: readonly AppFixedTabDestination[],
  intent: AppFixedTabOpenIntent,
): boolean {
  return openAppTabFromDestinations(destinations, {
    ...intent,
    availability: "fixed",
  });
}

export function openAppTabFromDestinations(
  destinations: readonly AppFixedTabDestination[],
  intent: AppTabOpenIntent,
): boolean {
  const availability = intent.availability ?? "fixed";
  if (
    availability === "fixed"
      ? intent.params !== undefined || intent.title !== undefined
      : intent.target !== undefined
  )
    return false;
  if (intent.title !== undefined && typeof intent.title !== "string")
    return false;
  const params =
    intent.params === undefined
      ? null
      : jsonValueSchema.safeParse(intent.params);
  const target =
    intent.target === undefined
      ? null
      : jsonValueSchema.safeParse(intent.target);
  if (params?.success === false || target?.success === false) return false;
  const destination = destinations.find(
    (candidate) =>
      candidate.tab.ownerId === intent.tab.ownerId &&
      candidate.tab.tabId === intent.tab.tabId &&
      (candidate.availability ?? "fixed") === availability,
  );
  if (destination === undefined) return false;
  return availability === "fixed"
    ? destination.open(target?.success ? target.data : undefined)
    : destination.open(undefined, {
        ...(params?.success ? { params: params.data } : {}),
        ...(intent.title === undefined ? {} : { title: intent.title }),
      });
}

interface AppFixedTabTargetSnapshot {
  ownerId: string;
  sequence: number;
  tabId: string;
  target: JsonValue;
}

export interface AppFixedTabTargetState extends AppFixedTabTargetSnapshot {
  clear(): void;
}

const AppFixedTabTargetContext = createContext<AppFixedTabTargetState | null>(
  null,
);

export function AppFixedTabTargetProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: AppFixedTabTargetState | null;
}) {
  return (
    <AppFixedTabTargetContext.Provider value={state}>
      {children}
    </AppFixedTabTargetContext.Provider>
  );
}

export function useAppFixedTabTarget(
  ownerId: string,
  tabId: string,
): AppFixedTabTargetState | null {
  const state = useContext(AppFixedTabTargetContext);
  return state?.ownerId === ownerId && state.tabId === tabId ? state : null;
}
