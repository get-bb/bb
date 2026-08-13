import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  PluginPrimaryTabLifecycleState,
  PluginPrimaryTabTarget,
} from "@bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePluginSlots, type PluginPrimaryTabSlot } from "@/lib/plugin-slots";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { PluginIcon } from "./PluginIcon";
import { PluginSlotMount } from "./PluginSlotMount";

const PRIMARY_TAB_ROUTE_STORAGE_PREFIX = "bb.primary-tab.route.";

export type PrimaryTabNavigationType =
  | "navigate"
  | "reload"
  | "back_forward"
  | "prerender";

interface InitialPrimaryTabRoute {
  navigationType: PrimaryTabNavigationType;
  path: string;
}

function currentNavigationType(): PrimaryTabNavigationType {
  if (
    typeof performance === "undefined" ||
    typeof performance.getEntriesByType !== "function"
  ) {
    return "navigate";
  }
  const [navigation] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  return navigation?.type ?? "navigate";
}

export function shouldApplyDefaultPrimaryTabStartup(
  initial: InitialPrimaryTabRoute,
): boolean {
  const pathname = new URL(initial.path, "http://bb.local").pathname;
  return (
    pathname === getRootComposeRoutePath() ||
    initial.navigationType === "reload"
  );
}

function targetPath(pluginId: string, target: PluginPrimaryTabTarget): string {
  switch (target.kind) {
    case "plugin-panel": {
      const path = getPluginPanelRoutePath({
        pluginId,
        path: target.path,
        ...(target.subPath !== undefined ? { subPath: target.subPath } : {}),
      });
      const query = new URLSearchParams(
        Object.entries(target.query ?? {}).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ).toString();
      return query === "" ? path : `${path}?${query}`;
    }
    case "thread":
      return getThreadRoutePath({
        projectId: target.projectId,
        threadId: target.threadId,
      });
    case "route":
      return target.path;
  }
}

function routeMatchesTarget(
  pluginId: string,
  target: PluginPrimaryTabTarget,
  path: string,
): boolean {
  const expected = targetPath(pluginId, target);
  const expectedUrl = new URL(expected, "http://bb.local");
  const actualUrl = new URL(path, "http://bb.local");
  if (target.kind === "thread") {
    return actualUrl.pathname === expectedUrl.pathname;
  }
  const prefix = target.kind === "plugin-panel" || target.match === "prefix";
  return prefix
    ? actualUrl.pathname === expectedUrl.pathname ||
        actualUrl.pathname.startsWith(`${expectedUrl.pathname}/`)
    : actualUrl.pathname === expectedUrl.pathname;
}

function tabStorageKey(tab: PluginPrimaryTabSlot): string {
  return `${PRIMARY_TAB_ROUTE_STORAGE_PREFIX}${tab.pluginId}.${tab.id}`;
}

function readPersistedRoute(tab: PluginPrimaryTabSlot): string | null {
  try {
    return window.sessionStorage.getItem(tabStorageKey(tab));
  } catch {
    return null;
  }
}

function persistRoute(tab: PluginPrimaryTabSlot, path: string): void {
  try {
    window.sessionStorage.setItem(tabStorageKey(tab), path);
  } catch {
    // Storage may be unavailable in hardened or private browser contexts.
  }
}

function isLifecycleTarget(value: unknown): value is PluginPrimaryTabTarget {
  if (value === null || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  switch (target.kind) {
    case "plugin-panel":
      return (
        typeof target.path === "string" &&
        /^[a-zA-Z0-9_-]+$/u.test(target.path) &&
        (target.subPath === undefined || typeof target.subPath === "string") &&
        (target.query === undefined ||
          (target.query !== null &&
            typeof target.query === "object" &&
            !Array.isArray(target.query) &&
            Object.entries(target.query).every(
              ([key, queryValue]) =>
                key.length > 0 && typeof queryValue === "string",
            )))
      );
    case "thread":
      return (
        typeof target.projectId === "string" &&
        target.projectId.length > 0 &&
        typeof target.threadId === "string" &&
        target.threadId.length > 0
      );
    case "route":
      return (
        typeof target.path === "string" &&
        target.path.startsWith("/") &&
        (target.match === "exact" || target.match === "prefix")
      );
    default:
      return false;
  }
}

function normalizedLifecycleState(
  state: PluginPrimaryTabLifecycleState,
): PluginPrimaryTabLifecycleState | null {
  if (state === null || typeof state !== "object") return null;
  if (typeof state.available !== "boolean") return null;
  if (state.target !== undefined && !isLifecycleTarget(state.target))
    return null;
  if (state.badge === undefined || state.badge === null) return state;
  if (
    typeof state.badge !== "object" ||
    !Number.isSafeInteger(state.badge.count) ||
    state.badge.count < 0 ||
    typeof state.badge.label !== "string" ||
    state.badge.label.trim() === "" ||
    typeof state.badge.tone !== "string" ||
    !["neutral", "unread", "needs-input"].includes(state.badge.tone)
  ) {
    return null;
  }
  return state;
}

function PrimaryTabLifecycle({
  tab,
  update,
}: {
  tab: PluginPrimaryTabSlot;
  update(
    tab: PluginPrimaryTabSlot,
    state: PluginPrimaryTabLifecycleState | null,
  ): void;
}) {
  const updateState = useCallback(
    (state: PluginPrimaryTabLifecycleState) => {
      const normalized = normalizedLifecycleState(state);
      if (normalized === null) {
        console.warn(
          `[plugin:${tab.pluginId}] primary tab "${tab.id}" published invalid lifecycle state`,
        );
        return;
      }
      update(tab, normalized);
    },
    [tab, update],
  );
  useEffect(() => () => update(tab, null), [tab, update]);
  if (tab.lifecycle === undefined) return null;
  return (
    <PluginSlotMount
      pluginId={tab.pluginId}
      slotKind="primaryTabLifecycle"
      slotId={tab.id}
      crashFallback={null}
    >
      <tab.lifecycle update={updateState} />
    </PluginSlotMount>
  );
}

function badgeClassName(tone: "neutral" | "unread" | "needs-input"): string {
  switch (tone) {
    case "needs-input":
      return "bg-warning text-warning-foreground";
    case "unread":
      return "bg-primary text-primary-foreground";
    case "neutral":
      return "bg-muted text-muted-foreground";
  }
}

/** Persistent host-owned bottom navigation for plugin primary tabs. */
export function PluginPrimaryTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { navPanels, primaryTabs = [] } = usePluginSlots();
  const tabs = useMemo(
    () =>
      [...primaryTabs].sort(
        (left, right) =>
          left.order - right.order ||
          left.pluginId.localeCompare(right.pluginId) ||
          left.id.localeCompare(right.id),
      ),
    [primaryTabs],
  );
  const [liveState, setLiveState] = useState<
    ReadonlyMap<string, PluginPrimaryTabLifecycleState>
  >(new Map());
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const startupHandled = useRef(false);
  const initialRoute = useRef<InitialPrimaryTabRoute>({
    navigationType: currentNavigationType(),
    path: `${location.pathname}${location.search}${location.hash}`,
  });

  const updateLiveState = useCallback(
    (
      tab: PluginPrimaryTabSlot,
      state: PluginPrimaryTabLifecycleState | null,
    ) => {
      const key = `${tab.pluginId}/${tab.id}`;
      setLiveState((current) => {
        const next = new Map(current);
        if (state === null) next.delete(key);
        else next.set(key, state);
        return next;
      });
    },
    [],
  );

  const resolved = useMemo(
    () =>
      tabs.map((tab) => {
        const state = liveState.get(`${tab.pluginId}/${tab.id}`);
        const primaryTarget = state?.target ?? tab.target;
        const pluginPanelAvailable =
          primaryTarget.kind !== "plugin-panel" ||
          navPanels.some(
            (panel) =>
              panel.pluginId === tab.pluginId &&
              panel.path === primaryTarget.path,
          );
        const available = (state?.available ?? true) && pluginPanelAvailable;
        const activeTarget = available
          ? primaryTarget
          : (tab.recoveryTarget ?? {
              kind: "route" as const,
              path: getRootComposeRoutePath(),
              match: "exact" as const,
            });
        return { tab, state, primaryTarget, activeTarget, available };
      }),
    [liveState, navPanels, tabs],
  );
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const activeIndex = resolved.findIndex(
    ({ tab, primaryTarget, activeTarget }) =>
      [primaryTarget, activeTarget].some((target) =>
        routeMatchesTarget(tab.pluginId, target, currentPath),
      ),
  );
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const rovingFocusIndex = focusIndex ?? (activeIndex >= 0 ? activeIndex : 0);

  const activate = useCallback(
    (index: number, options?: { replace?: boolean }) => {
      const entry = resolved[index];
      if (entry === undefined) return false;
      let nextPath = targetPath(entry.tab.pluginId, entry.activeTarget);
      if (entry.tab.routePersistence === "restore-last" && entry.available) {
        const persisted = readPersistedRoute(entry.tab);
        if (
          persisted !== null &&
          routeMatchesTarget(entry.tab.pluginId, entry.primaryTarget, persisted)
        ) {
          nextPath = persisted;
        }
      }
      void navigate(nextPath, options?.replace ? { replace: true } : undefined);
      return true;
    },
    [navigate, resolved],
  );

  useEffect(() => {
    if (startupHandled.current || resolved.length === 0) return;
    if (currentPath !== initialRoute.current.path) {
      startupHandled.current = true;
      return;
    }
    const defaultIndex = resolved.findIndex(({ tab }) => tab.defaultStartup);
    if (
      defaultIndex < 0 ||
      !shouldApplyDefaultPrimaryTabStartup(initialRoute.current)
    ) {
      startupHandled.current = true;
      return;
    }
    startupHandled.current = true;
    activate(defaultIndex, { replace: true });
  }, [activate, currentPath, resolved]);

  useEffect(() => {
    const active = resolved[activeIndex];
    if (active === undefined) return;
    if (
      active.tab.routePersistence === "restore-last" &&
      routeMatchesTarget(active.tab.pluginId, active.primaryTarget, currentPath)
    ) {
      persistRoute(active.tab, currentPath);
    }
    if (
      !active.available &&
      routeMatchesTarget(active.tab.pluginId, active.primaryTarget, currentPath)
    ) {
      void navigate(targetPath(active.tab.pluginId, active.activeTarget), {
        replace: true,
      });
    }
  }, [activeIndex, currentPath, navigate, resolved]);

  const moveFocus = (index: number) => {
    if (tabs.length === 0) return;
    const next = (index + tabs.length) % tabs.length;
    setFocusIndex(next);
    buttonRefs.current[next]?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(rovingFocusIndex - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveFocus(rovingFocusIndex + 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(tabs.length - 1);
        break;
    }
  };

  if (tabs.length === 0) return null;
  return (
    <>
      <div className="hidden" aria-hidden="true">
        {tabs.map((tab) => (
          <PrimaryTabLifecycle
            key={`${tab.pluginId}/${tab.id}/${tab.generation}`}
            tab={tab}
            update={updateLiveState}
          />
        ))}
      </div>
      <nav
        aria-label="Primary"
        className="shrink-0 border-t border-border bg-background"
      >
        <div
          role="tablist"
          aria-label="Primary tabs"
          className="mx-auto flex min-w-0 max-w-3xl items-stretch"
        >
          {resolved.map(({ tab, state }, index) => {
            const selected = index === activeIndex;
            const badge = state?.badge;
            const ariaLabel = badge
              ? `${tab.title}, ${badge.label}`
              : tab.title;
            return (
              <button
                key={`${tab.pluginId}/${tab.id}`}
                ref={(element) => {
                  buttonRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                aria-label={ariaLabel}
                aria-selected={selected}
                tabIndex={index === rovingFocusIndex ? 0 : -1}
                onClick={() => {
                  setFocusIndex(null);
                  activate(index);
                }}
                onKeyDown={handleKeyDown}
                className={cn(
                  "relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 px-3 text-sm font-medium outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  selected
                    ? "bg-state-active text-foreground"
                    : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                )}
              >
                <PluginIcon
                  pluginId={tab.pluginId}
                  icon={tab.icon}
                  className="size-4"
                />
                <span className="hidden min-[420px]:inline truncate">
                  {tab.title}
                </span>
                {badge && badge.count > 0 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                      badgeClassName(badge.tone),
                    )}
                  >
                    {badge.count > 99 ? "99+" : badge.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
