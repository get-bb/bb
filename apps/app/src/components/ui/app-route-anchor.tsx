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

type RouteNavigate = (path: string, options?: RouteNavigateOptions) => void;

interface RouteNavigation {
  navigate: RouteNavigate;
  openInSplit: (path: string) => boolean;
}

const RouteNavigationContext = createContext<RouteNavigation | null>(null);

const RouteNavigationPendingContext = createContext(false);

export function useIsRouteNavigationPending(): boolean {
  return useContext(RouteNavigationPendingContext);
}

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
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
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
