import { Navigate, Outlet } from "react-router-dom";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getRootComposeRoutePath } from "@/lib/route-paths";

export function ToolsExperimentGate() {
  const systemConfigQuery = useSystemConfig();
  const toolsHubEnabled = systemConfigQuery.data?.experiments.toolsHub;

  if (toolsHubEnabled === undefined) return null;
  if (!toolsHubEnabled) {
    return <Navigate to={getRootComposeRoutePath()} replace />;
  }
  return <Outlet />;
}
