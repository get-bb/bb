import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pathWithRetiredPluginIdsReplaced } from "@bb/domain";

export function useRedirectRetiredPluginPaths(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const pathname = pathWithRetiredPluginIdsReplaced(location.pathname);
    if (pathname === null) return;
    void navigate(
      { pathname, search: location.search, hash: location.hash },
      { replace: true },
    );
  }, [location.pathname, location.search, location.hash, navigate]);
}
