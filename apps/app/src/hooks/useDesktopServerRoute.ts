import { useEffect, useState } from "react";
import type {
  BbDesktopServerRoute,
  BbDesktopServerRouteSwitch,
} from "@bb/desktop-contract";
import { appToast } from "@/components/ui/app-toast";

export interface DesktopServerRouteState {
  route: BbDesktopServerRoute;
  setRoute(url: string | null): void;
}

export function useDesktopServerRoute(): DesktopServerRouteState | null {
  const [route, setRouteState] = useState<BbDesktopServerRoute | null>(null);
  const desktop = typeof window === "undefined" ? undefined : window.bbDesktop;
  const getServerRoute = desktop?.getServerRoute;
  const setServerRoute = desktop?.setServerRoute;
  useEffect(() => {
    if (desktop === undefined || getServerRoute === undefined) return;
    let current = true;
    void getServerRoute.call(desktop).then((initial) => {
      if (current) setRouteState(initial);
    });
    return () => {
      current = false;
    };
  }, [desktop, getServerRoute]);
  if (route === null || desktop === undefined || setServerRoute === undefined) {
    return null;
  }
  return {
    route,
    setRoute: (url) => setServerRoute.call(desktop, url),
  };
}

function routeSwitchTitle(
  serverName: string,
  switched: BbDesktopServerRouteSwitch,
): string {
  if (switched.reason === "unreachable") {
    return switched.fromLabel === null
      ? `${serverName}: reconnected via ${switched.toLabel}`
      : `${serverName}: ${switched.fromLabel} stopped answering, switched to ${switched.toLabel}`;
  }
  return `${serverName}: now via ${switched.toLabel}`;
}

export function DesktopServerRouteToasts() {
  useEffect(() => {
    const desktop = window.bbDesktop;
    return desktop?.onServerRouteChange?.((change) => {
      if (change.switched === null || change.route === null) return;
      const title = routeSwitchTitle(change.route.serverName, change.switched);
      if (change.switched.reason === "unreachable") appToast.warning(title);
      else appToast.message(title);
    });
  }, []);
  return null;
}
