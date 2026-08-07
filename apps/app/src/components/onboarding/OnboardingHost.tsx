import { useCallback, useEffect, useRef } from "react";
import type { DiscoveredRepo } from "@bb/host-daemon-contract";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import { useHostProviderCliStatus } from "@/hooks/queries/system-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  providerCliEntries,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { sdk } from "@/lib/sdk";

/**
 * Collapse the two spellings of one remote so SSH and HTTPS clones of the same
 * repository compare equal. A repo with no remote returns null and is never
 * matched — path is not available on a project, so those are left to the
 * server's own duplicate handling.
 */
function normalizeRemote(url: string | null): string | null {
  if (url === null) return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  return trimmed
    .replace(/\.git$/u, "")
    .replace(/^git@([^:]+):/u, "https://$1/")
    .replace(/^ssh:\/\/git@/u, "https://")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

/** Maps an onboarding provider id back to its managed-CLI key. */
const CLI_KEY_BY_PROVIDER: Record<string, "codex" | "claudeCode" | "cursor"> = {
  codex: "codex",
  "claude-code": "claudeCode",
  "acp-cursor": "cursor",
};
import {
  OnboardingFlow,
  type OnboardingAgentState,
  type OnboardingUiEvent,
} from "./OnboardingFlow";

/**
 * Decides whether first-run onboarding is showing, and owns its side effects:
 * creating the chosen projects, persisting the completion timestamp, and
 * reporting the funnel to the server's telemetry.
 *
 * Mounted once by the app shell. `onboardingCompletedAt` is the only gate —
 * whether an agent is actually usable is answered live by the agents query, so
 * dismissing onboarding never claims the machine is configured.
 */
export function OnboardingHost() {
  const configQuery = useSystemConfig();
  const updateSettings = useUpdateGeneralSettings();
  const createProject = useCreateProject();
  const primaryHost = usePrimaryHost();
  const navigationQuery = useSidebarNavigation();
  const installRunner = useProviderCliInstallRunner();
  // Stamped in an effect rather than during render: `Date.now()` in a render
  // body is impure and would drift on every re-render.
  const startedAt = useRef<number | null>(null);

  const settings = configQuery.data?.generalSettings;
  const primaryHostId = primaryHost?.id ?? null;
  // Migration 0085 stamps existing installs as already onboarded, so a null
  // timestamp means exactly one thing here: show the flow. That is what lets
  // Settings re-trigger it by clearing the column.
  const neverOnboarded =
    settings !== undefined && settings.onboardingCompletedAt === null;
  const cliStatusQuery = useHostProviderCliStatus({
    hostId: primaryHostId,
    // Only needed to build an install job, and only while the flow is open.
    // Left ungated this runs provider CLI and package-registry checks on every
    // app start, forever, for users who finished onboarding long ago.
    enabled: primaryHostId !== null && neverOnboarded,
  });

  const projects = navigationQuery.data?.projects;

  const installingProviders = new Set(
    Object.entries(CLI_KEY_BY_PROVIDER)
      .filter(([, cliKey]) => {
        if (primaryHostId === null) return false;
        const jobKey = providerCliJobKey(primaryHostId, cliKey);
        return (
          installRunner.runningJobKey === jobKey ||
          installRunner.queuedJobKeys.has(jobKey)
        );
      })
      .map(([providerId]) => providerId),
  );

  const installAgent = useCallback(
    (agent: { providerId: string }) => {
      const cliKey = CLI_KEY_BY_PROVIDER[agent.providerId];
      if (cliKey === undefined || primaryHostId === null) return;
      const status = cliStatusQuery.data;
      if (status === undefined) return;
      const issue = providerCliEntries(status)
        .filter((entry) => entry.provider === cliKey)
        .map(buildProviderCliIssue)
        .find((candidate) => candidate !== null);
      if (!issue || !hasProviderCliAction(issue)) return;
      installRunner.startInstall({ hostId: primaryHostId, issue });
    },
    [cliStatusQuery.data, installRunner, primaryHostId],
  );

  const shouldShow = neverOnboarded && primaryHostId !== null;

  // Stamp when the flow actually opens, so a re-trigger hours into a session
  // does not report the whole session as its duration.
  useEffect(() => {
    if (shouldShow) startedAt.current ??= Date.now();
    else startedAt.current = null;
  }, [shouldShow]);

  const addProjects = useCallback(
    async (repos: readonly DiscoveredRepo[]) => {
      if (primaryHostId === null) return;
      // Guard against re-adding a repo bb already tracks on replay. Projects
      // expose their remote, not their path, so the remote is the join key —
      // normalized, because `git@host:o/r.git` and `https://host/o/r` are the
      // same repository.
      const existingRemotes = new Set(
        (projects ?? [])
          .map((project) => normalizeRemote(project.gitRemoteUrl))
          .filter((remote): remote is string => remote !== null),
      );
      // Sequential: project creation touches the host workspace, and a burst of
      // parallel creates would race on the same daemon.
      for (const repo of repos) {
        const remote = normalizeRemote(repo.originUrl);
        if (remote !== null && existingRemotes.has(remote)) continue;
        await createProject.mutateAsync({
          name: repo.name,
          source: {
            type: "local_path",
            hostId: primaryHostId,
            path: repo.path,
          },
        });
      }
    },
    [createProject, primaryHostId, projects],
  );

  const report = useCallback((event: OnboardingUiEvent) => {
    void sdk.system
      .onboardingEvent(
        event.name === "started"
          ? {
              name: "onboarding_started",
              agentState: event.agentState,
              detectedAgentCount: event.agentCount,
            }
          : event.name === "step_skipped"
            ? { name: "onboarding_step_skipped", step: event.step }
            : { name: "onboarding_step_completed", step: event.step },
      )
      .catch(() => {
        // Telemetry is analytics, not workflow state.
      });
  }, []);

  const close = useCallback(
    (outcome: {
      completed: boolean;
      step: "agents" | "projects";
      projectsAdded: number;
      agentState: OnboardingAgentState;
    }) => {
      if (settings === undefined) return;
      updateSettings.mutate({
        onboardingCompletedAt: new Date().toISOString(),
      });
      void sdk.system
        .onboardingEvent(
          outcome.completed
            ? {
                name: "onboarding_completed",
                agentState: outcome.agentState,
                projectsAdded: outcome.projectsAdded,
                durationMs: Date.now() - (startedAt.current ?? Date.now()),
              }
            : { name: "onboarding_dismissed", step: outcome.step },
        )
        .catch(() => {});
    },
    [settings, updateSettings],
  );

  if (!shouldShow) return null;

  return (
    <OnboardingFlow
      installing={installingProviders}
      onAddProjects={addProjects}
      onClose={close}
      onEvent={report}
      onInstallAgent={installAgent}
    />
  );
}
