import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { atom, useAtomValue, useStore } from "jotai";
import { atomFamily } from "jotai-family";
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

interface FixedTabSessionTarget {
  sequence: number;
  target: JsonValue;
}

const fixedTabTargetAtomFamily = atomFamily((_targetId: string) =>
  atom<FixedTabSessionTarget | null>(null),
);

const targetIdsByStateKey = new Map<string, Set<string>>();

function fixedTabTargetId(stateKey: string, ownerId: string, tabId: string) {
  const id = `${stateKey}\0${ownerId}\0${tabId}`;
  const ids = targetIdsByStateKey.get(stateKey) ?? new Set<string>();
  ids.add(id);
  targetIdsByStateKey.set(stateKey, ids);
  return id;
}

export function useReleaseFixedTabTargets(stateKey: string): void {
  const store = useStore();
  useEffect(
    () => () => {
      for (const id of targetIdsByStateKey.get(stateKey) ?? []) {
        store.set(fixedTabTargetAtomFamily(id), null);
      }
    },
    [stateKey, store],
  );
}

export function useSetFixedTabTarget(): (args: {
  stateKey: string;
  ownerId: string;
  tabId: string;
  target: JsonValue;
}) => void {
  const store = useStore();
  return useCallback(
    ({ stateKey, ownerId, tabId, target }) => {
      store.set(
        fixedTabTargetAtomFamily(fixedTabTargetId(stateKey, ownerId, tabId)),
        (current) => ({ sequence: (current?.sequence ?? 0) + 1, target }),
      );
    },
    [store],
  );
}

export function useFixedTabTargetState(args: {
  stateKey: string;
  ownerId: string;
  tabId: string;
}): AppFixedTabTargetState | null {
  const { stateKey, ownerId, tabId } = args;
  const store = useStore();
  const targetAtom = fixedTabTargetAtomFamily(
    fixedTabTargetId(stateKey, ownerId, tabId),
  );
  const snapshot = useAtomValue(targetAtom);
  return useMemo(() => {
    if (snapshot === null) return null;
    const { sequence } = snapshot;
    return {
      ...snapshot,
      ownerId,
      tabId,
      clear: () => {
        store.set(targetAtom, (current) =>
          current?.sequence === sequence ? null : current,
        );
      },
    };
  }, [ownerId, snapshot, store, tabId, targetAtom]);
}
