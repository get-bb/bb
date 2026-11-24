import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { BbContext } from "@get-bb/plugin-sdk";
import { useRouteState } from "@/hooks/useRouteState";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";

export function useBbContext(): BbContext {
  const { projectId, threadId } = useRouteState();
  const content = paneContentForPathname(useLocation().pathname);
  const pluginPanel = content?.kind === "plugin-panel" ? content : null;
  const pluginId = pluginPanel?.pluginId ?? null;
  const path = pluginPanel?.panelPath ?? null;
  const subPath = pluginPanel?.subPath ?? "";
  return useMemo(
    () => ({
      projectId: projectId ?? null,
      threadId: threadId ?? null,
      experimental_pluginPanel:
        pluginId === null || path === null ? null : { pluginId, path, subPath },
    }),
    [path, pluginId, projectId, subPath, threadId],
  );
}
