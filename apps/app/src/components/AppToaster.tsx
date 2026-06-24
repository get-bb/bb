import { Toaster, type ToasterProps } from "@/components/ui/sonner.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import { POPOUT_ROUTE_PATH } from "@/lib/route-paths";
import { useLocation } from "react-router-dom";

function isPopoutPath(pathname: string): boolean {
  return (
    pathname === POPOUT_ROUTE_PATH ||
    pathname.startsWith(`${POPOUT_ROUTE_PATH}/`)
  );
}

export function AppToaster(props: ToasterProps) {
  const location = useLocation();
  const theme = usePreferredTheme();

  if (isPopoutPath(location.pathname)) {
    return null;
  }

  return <Toaster theme={theme} {...props} />;
}
