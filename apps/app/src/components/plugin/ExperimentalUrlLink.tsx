import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import type { ExperimentalUrlLinkProps } from "@get-bb/plugin-sdk";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { resolveRouteHref } from "@/lib/route-paths";

function shouldHandleUrlClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.currentTarget.hasAttribute("download")
  ) {
    return false;
  }
  return true;
}

function isCurrentAppRoute(href: string): boolean {
  return (
    typeof window !== "undefined" &&
    resolveRouteHref({ currentOrigin: window.location.origin, href }) !== null
  );
}

/** Host-rendered URL link shared by plugins and first-party app surfaces. */
export function ExperimentalUrlLink({
  href,
  onClick,
  rel,
  target,
  ...anchorProps
}: ExperimentalUrlLinkProps) {
  const navigation = useAppNavigationHost();
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (
        !shouldHandleUrlClick(event) ||
        isCurrentAppRoute(href) ||
        !navigation.openUrl({ url: href })
      ) {
        return;
      }
      event.preventDefault();
    },
    [href, navigation, onClick],
  );
  return (
    <RouteAnchor
      {...anchorProps}
      href={href}
      target={target}
      rel={target === "_blank" ? (rel ?? "noopener noreferrer") : rel}
      onClick={handleClick}
    />
  );
}
