import { atom, useAtomValue, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import { jsonValueSchema } from "@bb/domain";
import type {
  ExperimentalAppPanel,
  ExperimentalFixedTabTargetContract,
} from "@get-bb/plugin-sdk";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type {
  AppFixedTabOpenIntent,
  AppFixedTabReference,
} from "@/lib/app-navigation-host";

export interface AppFixedTabDestination {
  open(target: JsonValue | undefined, toggle?: boolean): boolean;
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
  const destination = destinations.find(
    (candidate) =>
      candidate.tab.ownerId === intent.tab.ownerId &&
      candidate.tab.tabId === intent.tab.tabId,
  );
  return destination?.open(intent.target, intent.toggle ?? false) ?? false;
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
export const fixedTabTargetAtomFamily = atomFamily((_targetId: string) =>
  atom<FixedTabSessionTarget | null>(null),
);
export function threadFixedTabTargetKey(
  threadId: string,
  tab: AppFixedTabReference,
): string {
  return `thread:${threadId}\0${tab.ownerId}\0${tab.tabId}`;
}
export function useThreadFixedTabTargetLifetime(threadId: string) {
  const store = useStore();
  useLayoutEffect(
    () => () => {
      for (const key of fixedTabTargetAtomFamily.getParams()) {
        if (key.startsWith(`thread:${threadId}\0`))
          store.set(fixedTabTargetAtomFamily(key), null);
      }
    },
    [store, threadId],
  );
}
export function useFixedTabSessionTarget(
  key: string,
  tab: AppFixedTabReference,
): AppFixedTabTargetState | null {
  const store = useStore();
  const targetAtom = fixedTabTargetAtomFamily(key);
  const snapshot = useAtomValue(targetAtom);
  return useMemo(
    () =>
      snapshot === null
        ? null
        : {
            ...snapshot,
            ownerId: tab.ownerId,
            tabId: tab.tabId,
            clear() {
              store.set(targetAtom, (current) =>
                current?.sequence === snapshot.sequence ? null : current,
              );
            },
          },
    [store, targetAtom, snapshot, tab.ownerId, tab.tabId],
  );
}
export function createValidatedFixedTabDestination({
  tab,
  contract,
  deliver,
  select,
}: {
  tab: AppFixedTabReference;
  contract: ExperimentalFixedTabTargetContract<JsonValue> | undefined;
  deliver(target: JsonValue): void;
  select(toggle: boolean): void;
}): AppFixedTabDestination {
  return {
    tab,
    open(target, toggle = false) {
      if (toggle && target !== undefined) return false;
      if (target !== undefined) {
        const parsed = jsonValueSchema.safeParse(target);
        if (!parsed.success || contract === undefined) return false;
        try {
          if (!contract.validate(parsed.data)) return false;
        } catch {
          return false;
        }
        deliver(parsed.data);
      }
      select(toggle);
      return true;
    },
  };
}

export function createPluginFixedTabOpener(
  pluginId: string,
  open: (intent: AppFixedTabOpenIntent) => boolean,
): ExperimentalAppPanel["openFixedTab"] {
  return (options) => {
    if (options.tab.panelId !== undefined && "experimental_toggle" in options)
      return false;
    const target =
      options.target === undefined
        ? null
        : jsonValueSchema.safeParse(options.target);
    if (target !== null && !target.success) return false;
    return open({
      surface: options.surface,
      tab: {
        ownerId:
          options.tab.panelId === undefined
            ? getThreadFixedTabOwnerId(pluginId)
            : getPluginFixedTabOwnerId(pluginId, options.tab.panelId),
        tabId: options.tab.id,
      },
      ...(target?.success ? { target: target.data } : {}),
      ...("experimental_toggle" in options
        ? { toggle: options.experimental_toggle }
        : {}),
    });
  };
}
const focusedFixedTabOpeners = new Map<
  symbol,
  (intent: AppFixedTabOpenIntent) => boolean
>();
export function usePublishFixedTabOpener(
  open: (intent: AppFixedTabOpenIntent) => boolean,
  active: boolean,
) {
  const current = useRef(open);
  useLayoutEffect(() => {
    current.current = open;
  }, [open]);
  useEffect(() => {
    if (!active) return;
    const token = Symbol();
    focusedFixedTabOpeners.set(token, (intent) => current.current(intent));
    return () => {
      focusedFixedTabOpeners.delete(token);
    };
  }, [active]);
}
export function getActiveFixedTabOpener() {
  return [...focusedFixedTabOpeners.values()].at(-1) ?? null;
}
