import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";
import { isRoutePath, resolveRouteHref } from "@/lib/route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";

export interface RouteNavigationProviderProps {
  children: ReactNode;
}

export interface RouteAnchorProps extends Omit<
  ComponentPropsWithoutRef<"a">,
  "href"
> {
  href: string | undefined;
}

interface ShouldHandleRouteAnchorClickArgs {
  event: ReactMouseEvent<HTMLAnchorElement>;
}

export interface RouteNavigateOptions {
  replace?: boolean;
  state?: NavigateOptions["state"];
}

/** Navigate to an absolute app route (`/projects/...`); see {@link useRouteNavigate}. */
export type RouteNavigate = (
  path: string,
  options?: RouteNavigateOptions,
) => void;

const RouteNavigationContext = createContext<RouteNavigate | null>(null);

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
  return useContext(RouteNavigationContext) ?? navigateWithoutProvider;
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
  // The live `navigate` changes per pathname; the context value must not, or
  // every consumer would re-render per navigation (the thing this exists to
  // avoid). Layout effect: the ref is current before any child effect or
  // event handler can navigate after a commit.
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const navigateRoute = useCallback<RouteNavigate>((path, options) => {
    if (options === undefined) {
      navigateRef.current(path);
      return;
    }
    navigateRef.current(path, options);
  }, []);
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

  return (
    <RouteNavigationContext.Provider value={navigateRoute}>
      {children}
    </RouteNavigationContext.Provider>
  );
}

export function RouteAnchor({
  href,
  onClick,
  rel,
  target,
  ...anchorProps
}: RouteAnchorProps) {
  const navigateRoute = useContext(RouteNavigationContext);
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
        navigateRoute === null ||
        !shouldHandleRouteAnchorClick({ event })
      ) {
        return;
      }

      event.preventDefault();
      navigateRoute(route.path);
    },
    [navigateRoute, onClick, route],
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
