import { useMemo, type ReactNode } from "react";
import { useProfiles } from "@/app-shell/ProfilesProvider";
import { WorkspacePanelProvider } from "./PanelProvider";
import type { PanelScope } from "./panel-model";

/** The web's root-compose panel state id, namespaced per server profile. */
function rootComposePanelStateId(profileId: string): string {
  return `root-compose:${profileId}`;
}

interface ProjectWorkspacePanelProviderProps {
  /** The project the compose screen is targeting (null = personal / none yet). */
  projectId: string | null;
  /** A reused environment picked on the compose screen, else null. */
  environmentId: string | null;
  /** The machine the thread will run on (host_path terminals, project file reads). */
  hostId: string | null;
  children: ReactNode;
}

/**
 * The root-compose panel: Files (project paths + previews) and Terminal
 * (host_path target) before a thread exists. Device-local only — there is
 * no thread to sync against — under one state per server profile, like the
 * web's `root-compose` panel state per origin. Info and Diff do not apply.
 */
export function ProjectWorkspacePanelProvider({
  projectId,
  environmentId,
  hostId,
  children,
}: ProjectWorkspacePanelProviderProps) {
  const { activeProfile } = useProfiles();
  const profileId = activeProfile?.id ?? "none";
  const scope = useMemo<PanelScope>(
    () => ({ kind: "project", projectId, environmentId, hostId }),
    [environmentId, hostId, projectId],
  );
  return (
    <WorkspacePanelProvider
      scope={scope}
      panelStateId={rootComposePanelStateId(profileId)}
      syncThreadId={null}
      showInfo={false}
      showDiff={false}
    >
      {children}
    </WorkspacePanelProvider>
  );
}
