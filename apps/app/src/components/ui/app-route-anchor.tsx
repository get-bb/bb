import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useTransition,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { isRoutePath, resolveRouteHref } from "@/lib/route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";

interface RouteNavigationProviderProps {
  children: ReactNode;
}

interface RouteAnchorProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  href: string | undefined;
}

interface ShouldHandleRouteAnchorClickArgs {
  event: ReactMouseEvent<HTMLAnchorElement>;
}

interface RouteNavigateOptions {
  replace?: boolean;
  state?: NavigateOptions["state"];
}

/** Navigate to an absolute app route (`/projects/...`); see {@link useRouteNavigate}. */
type RouteNavigate = (path: string, options?: RouteNavigateOptions) => void;

interface RouteNavigation {
  navigate: RouteNavigate;
  /**
   * Opens a route beside the focused pane, the way cmd-click on a sidebar
   * row does. Returns false — and does nothing — when the route is not pane
   * content or splits are off, so the caller can fall back to the browser.
   */
  openInSplit: (path: string) => boolean;
}

const RouteNavigationContext = createContext<RouteNavigation | null>(null);

// Separate from RouteNavigationContext on purpose: the pending bit flips on
// every navigation, and folding it into the navigate context would re-render
// every navigate consumer (sidebar rows, thread actions) per navigation —
// the exact churn RouteNavigationContext exists to avoid.
const RouteNavigationPendingContext = createContext(false);

/**
 * True while a navigation started through {@link useRouteNavigate} or
 * {@link RouteAnchor} is still rendering the destination route. Navigation
 * runs at transition priority, so the previous route stays on screen for a
 * beat; surfaces read this to show a lightweight pending affordance (e.g.
 * keeping the tapped row's active state) instead of appearing unresponsive.
 */
export function useIsRouteNavigationPending(): boolean {
  return useContext(RouteNavigationPendingContext);
}

/**
 * A `navigate` whose identity never changes and whose caller does not
 * subscribe to the router's location.
 *
 * Under `<BrowserRouter>` react-router's `useNavigate()` reads `useLocation()`
 * and rebuilds its function per pathname, so every component that calls it
 * re-renders on every navigation and every callback listing it as a
 * dependency is rebuilt. Sidebar rows, the thread-actions context and the fork
 * handler only navigate to absolute app routes, so they read this one stable
 * function from {@link RouteNavigationProvider} (mounted once at the app root,
 * which holds the live `useNavigate()` in a ref) instead. Without a provider
 * the returned function throws when called, so a misplaced consumer fails at
 * the click, not silently.
 */
export function useRouteNavigate(): RouteNavigate {
  return (
    useContext(RouteNavigationContext)?.navigate ?? navigateWithoutProvider
  );
}

function navigateWithoutProvider(path: string): void {
  throw new Error(
    `useRouteNavigate: no <RouteNavigationProvider> above the caller (navigating to "${path}")`,
  );
}

function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

function shouldHandleRouteAnchorClick({
  event,
}: ShouldHandleRouteAnchorClickArgs): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");
  return target === null || target === "" || target === "_self";
}

export function RouteNavigationProvider({
  children,
}: RouteNavigationProviderProps) {
  const navigate = useNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  // The live `navigate` changes per pathname; the context value must not, or
  // every consumer would re-render per navigation (the thing this exists to
  // avoid). Layout effect: the ref is current before any child effect or
  // event handler can navigate after a commit.
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  // Navigate at transition priority: a tap's urgent commit (active states,
  // isNavigationPending) paints first, and the destination route renders in an
  // interruptible follow-up commit instead of blocking the tap's frame.
  // `startNavigationTransition` has a stable identity, so `navigateRoute`
  // keeps the never-changing identity its consumers depend on.
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const navigateRoute = useCallback<RouteNavigate>(
    (path, options) => {
      startNavigationTransition(() => {
        if (options === undefined) {
          navigateRef.current(path);
          return;
        }
        navigateRef.current(path, options);
      });
    },
    [startNavigationTransition],
  );
  const openInSplit = useCallback<RouteNavigation["openInSplit"]>(
    (path) => {
      const content = paneContentForPathname(path.split(/[?#]/)[0] ?? path);
      if (content === null) return false;
      openPaneContentInSplit({
        store,
        navigate: navigateRoute,
        content,
        route: path,
        enabled: !isCompact,
      });
      return true;
    },
    [isCompact, navigateRoute, store],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    return browserApi.onOpenTab(({ url }) => {
      if (!isRoutePath({ path: url })) {
        return;
      }
      navigateRoute(url);
    });
  }, [navigateRoute]);

  const value = useMemo<RouteNavigation>(
    () => ({ navigate: navigateRoute, openInSplit }),
    [navigateRoute, openInSplit],
  );
  return (
    <RouteNavigationContext.Provider value={value}>
      <RouteNavigationPendingContext.Provider value={isNavigationPending}>
        {children}
      </RouteNavigationPendingContext.Provider>
    </RouteNavigationContext.Provider>
  );
}

/**
 * A click handler for a container whose descendants may include anchors to
 * app routes — plugin-rendered UI, chiefly. Plain clicks on such anchors
 * navigate client-side, so the app's Back button keeps working; cmd/ctrl
 * clicks open the route beside the focused pane when it can live in one.
 * Links to a plugin's own page (its Extensions detail) open beside on any
 * click: that page is a companion to whatever you are reading, and the
 * Extensions list will open it the same way. Every other click, and every
 * anchor to anywhere else, is left to the browser. Outside a
 * RouteNavigationProvider it does nothing.
 */
export function useRouteAnchorDelegate(): (
  event: ReactMouseEvent<HTMLElement>,
) => void {
  const navigation = useContext(RouteNavigationContext);
  return useCallback(
    (event) => {
      if (navigation === null || event.defaultPrevented) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (anchor === null || !event.currentTarget.contains(anchor)) return;
      const target = anchor.getAttribute("target");
      if (target !== null && target !== "" && target !== "_self") return;
      if (event.button !== 0 || event.altKey || event.shiftKey) return;
      const origin = currentOrigin();
      if (origin === null) return;
      const route = resolveRouteHref({
        currentOrigin: origin,
        href: anchor.getAttribute("href") ?? "",
      });
      if (route === null) return;
      const opensBeside =
        event.metaKey ||
        event.ctrlKey ||
        paneContentForPathname(route.path.split(/[?#]/)[0] ?? route.path)
          ?.kind === "plugin-detail";
      if (opensBeside) {
        if (navigation.openInSplit(route.path)) event.preventDefault();
        return;
      }
      event.preventDefault();
      navigation.navigate(route.path);
    },
    [navigation],
  );
}

export function RouteAnchor({
  href,
  onClick,
  rel,
  target,
  ...anchorProps
}: RouteAnchorProps) {
  const navigation = useContext(RouteNavigationContext);
  const route = useMemo(() => {
    const origin = currentOrigin();
    return origin === null || href === undefined
      ? null
      : resolveRouteHref({ currentOrigin: origin, href });
  }, [href]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (
        route === null ||
        navigation === null ||
        !shouldHandleRouteAnchorClick({ event })
      ) {
        return;
      }

      event.preventDefault();
      navigation.navigate(route.path);
    },
    [navigation, onClick, route],
  );

  return (
    <a
      {...anchorProps}
      href={href}
      rel={route === null ? rel : undefined}
      target={route === null ? target : undefined}
      onClick={handleClick}
    />
  );
}
