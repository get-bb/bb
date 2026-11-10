import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  ProviderCliInstallAction,
  ProviderCliKey,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type {
  HostProviderCliInstallJob,
  InstalledPlugin,
  PluginUpdateJob,
  SystemAppUpdateStatus,
  SystemConfigResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import { SettingsStoryFixtures } from "../../../.ladle/settings-story-fixtures";
import {
  HOST_IDS,
  makeHost,
  makeProviderCliStatus,
} from "../../../.ladle/story-fixtures";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import { UpdatesSettingsSection } from "@/components/settings/UpdatesSettingsSection";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import { AppLayoutSidebar } from "@/components/layout/AppLayoutSidebar";
import {
  hostProviderCliStatusQueryKey,
  pluginListQueryKey,
  pluginUpdateJobsQueryKey,
  systemAppUpdateQueryKey,
  systemConfigQueryKey,
  systemVersionQueryKey,
} from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";

export default { title: "sidebar/Update button" };

const UPDATE: ProviderCliInstallAction = {
  kind: "update",
  label: "Update",
  command: "npm install -g",
};

interface ProviderVersions {
  current: string;
  latest: string;
}

const STALE_PROVIDERS: Partial<Record<ProviderCliKey, ProviderVersions>> = {
  codex: { current: "0.145.0", latest: "0.146.0" },
  "claude-code": { current: "2.1.0", latest: "2.1.4" },
};

function providerStatus(
  stale: Partial<Record<ProviderCliKey, ProviderVersions>>,
): ProviderCliStatusResponse {
  const status = (provider: ProviderCliKey, fallback: string) => {
    const versions = stale[provider];
    return makeProviderCliStatus(
      provider,
      versions === undefined
        ? { currentVersion: fallback, latestVersion: fallback }
        : {
            currentVersion: versions.current,
            latestVersion: versions.latest,
            needsUpdate: true,
            installAction: UPDATE,
          },
    );
  };
  return {
    codex: status("codex", "0.146.0"),
    "claude-code": status("claude-code", "2.1.4"),
  };
}

const PLUGIN_UPDATES = [
  { id: "linear", name: "Linear", icon: "Zap", from: "0.8.2", to: "0.9.0" },
  {
    id: "github-pr-status",
    name: "GitHub PR Status",
    icon: "GitPullRequest",
    from: "1.2.0",
    to: "1.4.1",
  },
] as const;

function installedPlugins(pending: ReadonlySet<string>): InstalledPlugin[] {
  return PLUGIN_UPDATES.map((plugin) =>
    makeInstalledPlugin({
      id: plugin.id,
      name: plugin.name,
      icon: plugin.icon,
      source: `npm:@acme/${plugin.id}@^${plugin.from}`,
      version: pending.has(plugin.id) ? plugin.from : plugin.to,
      updateState: pending.has(plugin.id)
        ? {
            outcome: "update-available",
            availableVersion: plugin.to,
            availableLabel: plugin.to,
          }
        : { outcome: "current" },
    }),
  );
}

function appUpdateStatus(input: {
  available: boolean;
  autoUpdate: boolean;
  runningThreadCount?: number;
}): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available: input.available
      ? {
          behindSince: null,
          channel: "latest",
          commit: null,
          commitCount: null,
          subjects: [],
          version: "0.49.0",
        }
      : null,
    blocked: null,
    current: { commit: null, version: "0.48.2" },
    lastResult: null,
    autoUpdate: input.autoUpdate,
    availableSkipped: false,
    runningThreadCount: input.runningThreadCount ?? 0,
    scheduled: null,
    support: { kind: "supported", mode: "npm" },
  };
}

interface Scenario {
  title: string;
  description: string;
  bb: "auto" | "manual" | null;
  providers: boolean;
  plugins: boolean;
  runningThreads?: number;
  failing?: ReadonlySet<string>;
  offlineMachine?: boolean;
}

function seedScenario(queryClient: QueryClient, scenario: Scenario): void {
  const config = queryClient.getQueryData<SystemConfigResponse>(
    systemConfigQueryKey(),
  );
  if (config !== undefined) {
    queryClient.setQueryData(systemConfigQueryKey(), {
      ...config,
      experiments: {
        ...config.experiments,
        pluginUpdates: true,
        updateWhenIdle: true,
      },
    });
  }
  queryClient.setQueryData(
    systemAppUpdateQueryKey(),
    appUpdateStatus({
      available: scenario.bb !== null,
      autoUpdate: scenario.bb === "auto",
      runningThreadCount: scenario.runningThreads,
    }),
  );
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.local),
    providerStatus(scenario.providers ? STALE_PROVIDERS : {}),
  );
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.remote),
    providerStatus({}),
  );
  queryClient.setQueryData(
    pluginListQueryKey(true),
    installedPlugins(
      new Set(scenario.plugins ? PLUGIN_UPDATES.map(({ id }) => id) : []),
    ),
  );
  queryClient.setQueryData(pluginUpdateJobsQueryKey(), []);
}

const UPDATE_DURATION_MS = 2500;

function useSimulatedUpdates(scenario: Scenario): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const failing = scenario.failing ?? new Set<string>();
    const staleProviders = { ...STALE_PROVIDERS };
    const pendingPlugins = new Set<string>(PLUGIN_UPDATES.map(({ id }) => id));
    const jobs = new Map<
      string,
      { job: PluginUpdateJob; startedAt: number; fails: boolean }
    >();
    const originalStartInstall = sdk.hosts.experimental_startProviderCliInstall;
    const originalInstallJobs = sdk.hosts.experimental_providerCliInstallJobs;
    const originalStatus = sdk.hosts.providerCliStatus;
    const originalFetch = window.fetch;
    const originalApply = sdk.system.applyAppUpdate;
    const originalAppUpdate = sdk.system.appUpdate;
    const originalVersion = sdk.system.version;
    const cachedAppUpdate = queryClient.getQueryData<SystemAppUpdateStatus>(
      systemAppUpdateQueryKey(),
    );
    const cachedVersion = queryClient.getQueryData<SystemVersionResponse>(
      systemVersionQueryKey(),
    );
    if (cachedAppUpdate !== undefined && cachedVersion !== undefined) {
      sdk.system.appUpdate = async () =>
        queryClient.getQueryData<SystemAppUpdateStatus>(
          systemAppUpdateQueryKey(),
        ) ?? cachedAppUpdate;
      sdk.system.version = async () => cachedVersion;
    }

    sdk.system.applyAppUpdate = async () => {
      const restarting: SystemAppUpdateStatus = {
        ...appUpdateStatus({
          available: true,
          autoUpdate: scenario.bb === "auto",
        }),
        activity: {
          phase: "restarting",
          startedAt: new Date().toISOString(),
          targetCommit: null,
          targetVersion: "0.49.0",
        },
      };
      queryClient.setQueryData(systemAppUpdateQueryKey(), restarting);
      return restarting;
    };

    const installs = new Map<string, Promise<HostProviderCliInstallJob>>();
    sdk.hosts.experimental_startProviderCliInstall = async ({
      hostId,
      provider,
      actionKind,
    }) => {
      const base = {
        id: `${hostId}:${provider}:${Date.now()}`,
        hostId,
        provider,
        actionKind,
        startedAt: Date.now(),
      };
      installs.set(
        base.id,
        new Promise((resolve) => {
          window.setTimeout(() => {
            const success = !failing.has(provider);
            if (success) {
              delete staleProviders[provider];
              queryClient.setQueryData(
                hostProviderCliStatusQueryKey(hostId),
                providerStatus(staleProviders),
              );
            }
            resolve({
              ...base,
              state: "completed",
              finishedAt: Date.now(),
              events: [
                {
                  type: "completed",
                  provider,
                  exitCode: success ? 0 : 1,
                  signal: null,
                  success,
                },
              ],
            });
          }, UPDATE_DURATION_MS);
        }),
      );
      return { ...base, state: "running" };
    };
    sdk.hosts.experimental_providerCliInstallJobs = {
      ...originalInstallJobs,
      list: async () => [],
      wait: async ({ jobId }) => {
        const install = installs.get(jobId);
        if (install === undefined) throw new Error(`Unknown job ${jobId}`);
        return install;
      },
    };
    sdk.hosts.providerCliStatus = async ({ hostId }) =>
      providerStatus(hostId === HOST_IDS.local ? staleProviders : {});

    function jobState(entry: {
      job: PluginUpdateJob;
      startedAt: number;
      fails: boolean;
    }): PluginUpdateJob {
      const { id, pluginId, displayName } = entry.job;
      const elapsed = Date.now() - entry.startedAt;
      if (elapsed < UPDATE_DURATION_MS) {
        return {
          id,
          pluginId,
          displayName,
          state: "running",
          phase: "activating",
        };
      }
      if (entry.fails) {
        return {
          id,
          pluginId,
          displayName,
          state: "failed",
          error: "activation failed",
        };
      }
      if (pendingPlugins.delete(pluginId)) {
        queryClient.setQueryData(
          pluginListQueryKey(true),
          installedPlugins(pendingPlugins),
        );
      }
      return {
        id,
        pluginId,
        displayName,
        state: "completed",
        result: {
          applied: true,
          outcome: "updated",
          from: { version: "0", label: "0", display: "0" },
        },
      };
    }

    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input.toString()
          : input.url,
        window.location.href,
      );
      const start = /^\/api\/v1\/plugins\/([^/]+)\/update$/u.exec(url.pathname);
      if (start !== null && init?.method === "POST") {
        const pluginId = decodeURIComponent(start[1] ?? "");
        const job: PluginUpdateJob = {
          id: `job-${pluginId}-${String(Date.now())}`,
          pluginId,
          displayName:
            PLUGIN_UPDATES.find((plugin) => plugin.id === pluginId)?.name ??
            pluginId,
          state: "queued",
        };
        jobs.set(job.id, {
          job,
          startedAt: Date.now(),
          fails: failing.has(pluginId),
        });
        return Response.json({ job });
      }
      if (url.pathname === "/api/v1/plugins/update-jobs") {
        return Response.json({ jobs: [...jobs.values()].map(jobState) });
      }
      return originalFetch(input, init);
    };

    return () => {
      sdk.hosts.experimental_startProviderCliInstall = originalStartInstall;
      sdk.hosts.experimental_providerCliInstallJobs = originalInstallJobs;
      sdk.hosts.providerCliStatus = originalStatus;
      window.fetch = originalFetch;
      sdk.system.applyAppUpdate = originalApply;
      sdk.system.appUpdate = originalAppUpdate;
      sdk.system.version = originalVersion;
    };
  }, [queryClient, scenario]);
}

function SeededScenario({
  scenario,
  children,
}: {
  scenario: Scenario;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [seeded] = useState(() => {
    seedScenario(queryClient, scenario);
    return true;
  });
  useSimulatedUpdates(scenario);
  return seeded ? children : null;
}

const OFFLINE_MACHINE_HOSTS = [
  makeHost({ id: HOST_IDS.local, name: "Work laptop" }),
  makeHost({
    id: HOST_IDS.remote,
    name: "Studio desktop",
    status: "disconnected",
    lastSeenAt: Date.now(),
  }),
];

function ScenarioStage({ scenario }: { scenario: Scenario }) {
  const { pathname } = useLocation();
  return (
    <SettingsStoryFixtures
      hosts={
        scenario.offlineMachine === true ? OFFLINE_MACHINE_HOSTS : undefined
      }
    >
      <SeededScenario scenario={scenario}>
        {pathname === "/settings/updates" ? (
          <SettingsStoryChrome activeSection="updates">
            <UpdatesSettingsSection />
          </SettingsStoryChrome>
        ) : (
          <SidebarProvider className="h-screen bg-background">
            <AppLayoutSidebar
              routeSidebar={null}
              isSettingsActive={false}
              isResizing={false}
              onResizeMouseDown={() => {}}
              settingsRoutePath="/settings/updates"
              backToAppRoutePath={null}
            />
            <SidebarInset>
              <main className="space-y-3 p-6">
                <SidebarTrigger />
                <h1 className="text-lg font-semibold">{scenario.title}</h1>
                <p className="max-w-lg text-sm text-muted-foreground">
                  {scenario.description}
                </p>
              </main>
            </SidebarInset>
          </SidebarProvider>
        )}
      </SeededScenario>
    </SettingsStoryFixtures>
  );
}

const SCENARIOS = {
  everything: {
    title: "bb, provider CLIs and plugins",
    description:
      "Hover the round button at the end of the footer. bb installs itself when you're idle; Update all runs the CLIs and plugins without restarting bb.",
    bb: "auto",
    providers: true,
    plugins: true,
  },
  clisAndPlugins: {
    title: "Only provider CLIs and plugins",
    description: "bb is current, so the card is just the list and Update all.",
    bb: null,
    providers: true,
    plugins: true,
  },
  onlyBb: {
    title: "Only bb",
    description:
      "The button stays so you can see what is coming and restart early. Two threads are running, so Restart now asks first.",
    bb: "auto",
    providers: false,
    plugins: false,
    runningThreads: 2,
  },
  bbManual: {
    title: "bb with automatic updates off",
    description: "bb waits for a restart; Restart now does it immediately.",
    bb: "manual",
    providers: false,
    plugins: true,
  },
  oneFails: {
    title: "One update fails",
    description:
      "Press Update all. Claude Code fails; the rest finish and the failure stays greyed out so it can be tried again.",
    bb: null,
    providers: true,
    plugins: true,
    failing: new Set(["claude-code"]),
  },
  offlineMachine: {
    title: "Updates with a machine offline",
    description:
      "The machine warning and the update button sit side by side at the end of the footer.",
    bb: "auto",
    providers: true,
    plugins: true,
    offlineMachine: true,
  },
} satisfies Record<string, Scenario>;

export function Everything() {
  return <ScenarioStage scenario={SCENARIOS.everything} />;
}

export function OnlyClisAndPlugins() {
  return <ScenarioStage scenario={SCENARIOS.clisAndPlugins} />;
}

export function OnlyBb() {
  return <ScenarioStage scenario={SCENARIOS.onlyBb} />;
}

export function BbWaitsForRestart() {
  return <ScenarioStage scenario={SCENARIOS.bbManual} />;
}

export function OneUpdateFails() {
  return <ScenarioStage scenario={SCENARIOS.oneFails} />;
}

export function UpdatesWithMachineOffline() {
  return <ScenarioStage scenario={SCENARIOS.offlineMachine} />;
}

export function MachineNotices() {
  const [offlineCount, setOfflineCount] = useState(2);
  const [lastSeenAt, setLastSeenAt] = useState(Date.now);
  const { pathname } = useLocation();
  const hosts = useMemo(
    () =>
      ["Work laptop", "Studio desktop"].map((name, index) =>
        makeHost({
          id: index === 0 ? HOST_IDS.local : HOST_IDS.remote,
          name,
          status: offlineCount > index ? "disconnected" : "connected",
          lastSeenAt,
          lastRejectedProtocolVersion:
            index === 0 && offlineCount > 0 ? 1 : null,
        }),
      ),
    [offlineCount, lastSeenAt],
  );

  return (
    <SettingsStoryFixtures hosts={hosts}>
      {pathname === "/settings/machines" ? (
        <SettingsStoryChrome activeSection="machines">
          <MachinesSettingsSection />
        </SettingsStoryChrome>
      ) : (
        <SidebarProvider className="h-screen bg-background">
          <AppLayoutSidebar
            routeSidebar={null}
            isSettingsActive={false}
            isResizing={false}
            onResizeMouseDown={() => {}}
            settingsRoutePath="/settings/machines"
            backToAppRoutePath={null}
          />
          <SidebarInset>
            <main className="space-y-6 p-6">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold">Machine notices</h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                Hover the footer warning, then open it to see the machines.
                Return to the app: the same outage stays acknowledged.
              </p>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((count) => (
                  <Button
                    key={count}
                    variant={offlineCount === count ? "default" : "outline"}
                    onClick={() => setOfflineCount(count)}
                  >
                    {count === 0
                      ? "All online"
                      : count === 1
                        ? "One offline"
                        : "Two offline"}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setLastSeenAt(Date.now())}
                >
                  New outage
                </Button>
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      )}
    </SettingsStoryFixtures>
  );
}
