import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { resolveAppRouteHref } from "@/lib/app-route-paths";

export interface AppRouteNavigationProviderProps {
  children: ReactNode;
}

export interface AppRouteAnchorProps
  extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  href: string | undefined;
}

interface ShouldHandleAppRouteAnchorClickArgs {
  event: ReactMouseEvent<HTMLAnchorElement>;
}

type AppRouteNavigate = (path: string) => void;

const AppRouteNavigationContext = createContext<AppRouteNavigate | null>(null);

function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

function shouldHandleAppRouteAnchorClick({
  event,
}: ShouldHandleAppRouteAnchorClickArgs): boolean {
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

export function AppRouteNavigationProvider({
  children,
}: AppRouteNavigationProviderProps) {
  const navigate = useNavigate();
  const navigateAppRoute = useCallback<AppRouteNavigate>(
    (path) => {
      navigate(path);
    },
    [navigate],
  );

  return (
    <AppRouteNavigationContext.Provider value={navigateAppRoute}>
      {children}
    </AppRouteNavigationContext.Provider>
  );
}

export function AppRouteAnchor({
  href,
  onClick,
  rel,
  target,
  ...anchorProps
}: AppRouteAnchorProps) {
  const navigateAppRoute = useContext(AppRouteNavigationContext);
  const appRoute = useMemo(() => {
    const origin = currentOrigin();
    return origin === null || href === undefined
      ? null
      : resolveAppRouteHref({ currentOrigin: origin, href });
  }, [href]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (
        appRoute === null ||
        navigateAppRoute === null ||
        !shouldHandleAppRouteAnchorClick({ event })
      ) {
        return;
      }

      event.preventDefault();
      navigateAppRoute(appRoute.path);
    },
    [appRoute, navigateAppRoute, onClick],
  );

  return (
    <a
      {...anchorProps}
      href={href}
      rel={appRoute === null ? rel : undefined}
      target={appRoute === null ? target : undefined}
      onClick={handleClick}
    />
  );
}
