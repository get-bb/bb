import { useCallback, useContext } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

function navigatorPathname(navigator: object): string | null {
  if (!("location" in navigator)) return null;
  const location = navigator.location;
  return typeof location === "object" &&
    location !== null &&
    "pathname" in location &&
    typeof location.pathname === "string"
    ? location.pathname
    : null;
}

export function useLatestRoutePathname(): () => string | null {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  return useCallback(() => navigatorPathname(navigator), [navigator]);
}
