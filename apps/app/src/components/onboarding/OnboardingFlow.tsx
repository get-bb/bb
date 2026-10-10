import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  isActiveTerminalSessionStatus,
  mobileAppDownloads,
} from "@bb/domain";
import type { TerminalOutputChunk, TerminalSession } from "@bb/server-contract";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import {
  openProviderCliInstallLog,
  providerCliJobKey,
} from "@/components/provider-cli/provider-cli-install-store";
import { ThreadTerminalView } from "@/components/thread/terminal/ThreadTerminalView";
import { appToast } from "@/components/ui/app-toast";
import { applyPluginInstallJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import {
  useHostDiscoveredRepos,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  startCatalogPluginInstall,
  useCatalogEntryInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { terminalOutputTailQueryKey } from "@/hooks/queries/query-keys";
import {
  useHostProviderCliStatus,
  useSystemConfig,
  useSystemProviderStates,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import {
  useCloseTerminal,
  useCreateTerminal,
} from "@/hooks/queries/thread-terminal-queries";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  getBbDesktopInfo,
  shouldReserveMacosTrafficLights,
} from "@/lib/bb-desktop";
import { isInsideNativeShell } from "@/lib/native-shell/native-shell";
import { decodeBase64Bytes } from "@/lib/base64-bytes";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { sdk } from "@/lib/sdk";
import { formatRelativeTime } from "@/lib/relative-time";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  AgentSignInGuide,
  AgentStep,
  DevicesStep,
  OnboardingLayout,
  OnboardingPluginCard,
  OnboardingPluginGrid,
  OnboardingPluginGridSkeleton,
  ProjectsStep,
  type OnboardingAgent,
  type OnboardingRepo,
} from "./OnboardingViews";
import {
  CONNECT_PLUGIN_ID,
  ONBOARDING_PLUGINS,
  ONBOARDING_PLUGIN_MARKETPLACE,
  connectAccessUrl,
  defaultSelectedRepoPaths,
  hasRecentImportableRepo,
  hasReadyAgent,
  parseSignInOutput,
  resolveAgentSetupState,
  resolveSignInCommand,
  shortRemoteName,
  type OnboardingStepId,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

const SIGN_IN_POLL_INTERVAL_MS = 3_000;
const SIGN_IN_TERMINAL_COLS = 200;
const SIGN_IN_TERMINAL_ROWS = 14;
const SIGN_IN_OUTPUT_POLL_INTERVAL_MS = 1_000;
const SIGN_IN_OUTPUT_TAIL_BYTES = 64 * 1024;
const SIGN_IN_TERMINAL_FALLBACK_DELAY_MS = 6_000;
const INSTALL_FAILED_MESSAGE = "Install failed";
const PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS = 10_000;

function decodeTerminalChunks(chunks: readonly TerminalOutputChunk[]): string {
  const decoder = new TextDecoder();
  return chunks
    .map((chunk) =>
      decoder.decode(decodeBase64Bytes(chunk.dataBase64), { stream: true }),
    )
    .join("");
}

function encodeTerminalInput(text: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
}

function AgentSignInContainer({
  agentName,
  session,
  alternate,
  onUseAlternate,
  onExit,
}: {
  agentName: string;
  session: TerminalSession;
  alternate: { label: string; method: SignInMethod } | null;
  onUseAlternate: (method: SignInMethod) => void;
  onExit: (exitCode: number | null) => void;
}) {
  const outputQuery = useQuery({
    queryKey: terminalOutputTailQueryKey(session.id),
    queryFn: ({ signal }) =>
      sdk.terminals.output({
        terminalId: session.id,
        tailBytes: SIGN_IN_OUTPUT_TAIL_BYTES,
        signal,
      }),
    refetchInterval: SIGN_IN_OUTPUT_POLL_INTERVAL_MS,
    gcTime: 0,
    retry: false,
  });
  const output = outputQuery.data;
  const guide = useMemo(
    () =>
      output === undefined
        ? null
        : parseSignInOutput(decodeTerminalChunks(output.chunks)),
    [output],
  );
  const [code, setCode] = useState("");
  const [codeSubmitted, setCodeSubmitted] = useState(false);
  const [terminalChoice, setTerminalChoice] = useState<boolean | null>(null);
  const [fallbackDue, setFallbackDue] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFallbackDue(true),
      SIGN_IN_TERMINAL_FALLBACK_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);
  const terminalVisible =
    terminalChoice ?? (fallbackDue && (guide === null || guide.url === null));

  const exited =
    output !== undefined && !isActiveTerminalSessionStatus(output.status);
  const exitCode = output?.exitCode ?? null;
  useEffect(() => {
    if (exited) onExit(exitCode);
  }, [exitCode, exited, onExit]);

  const submitCode = () => {
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    setCodeSubmitted(true);
    sdk.terminals
      .input({
        terminalId: session.id,
        dataBase64: encodeTerminalInput(`${trimmed}\r`),
      })
      .catch(() => {
        setCodeSubmitted(false);
        appToast.error("Couldn't send the code. Try again.");
      });
  };

  return (
    <AgentSignInGuide
      agentName={agentName}
      guide={guide}
      code={code}
      codeSubmitted={codeSubmitted}
      terminalVisible={terminalVisible}
      terminal={
        <ThreadTerminalView autoFocus={false} isPanelOpen session={session} />
      }
      onCodeChange={(next) => {
        setCode(next);
        setCodeSubmitted(false);
      }}
      onSubmitCode={submitCode}
      onOpenUrl={openUrlInExternalBrowser}
      onCopy={(text) => void copyToClipboardWithToast(text)}
      onToggleTerminal={() => setTerminalChoice(!terminalVisible)}
      alternateLabel={alternate?.label ?? null}
      onUseAlternate={() => {
        if (alternate !== null) onUseAlternate(alternate.method);
      }}
    />
  );
}

interface StepChrome {
  compact: boolean;
  reserveMacosTrafficLights: boolean;
  onSelectStep: (step: OnboardingStepId) => void;
  onSkipAll: () => void;
}

async function closeAbandonedSignInTerminals({
  hostId,
  title,
}: {
  hostId: string;
  title: string;
}): Promise<void> {
  const listing = await sdk.terminals
    .list({ scope: { kind: "host_path", hostId } })
    .catch(() => null);
  const abandoned = (listing?.sessions ?? []).filter(
    (session) =>
      session.title === title && isActiveTerminalSessionStatus(session.status),
  );
  await Promise.all(
    abandoned.map((session) =>
      sdk.terminals
        .close({ mode: "force", terminalId: session.id })
        .catch(() => null),
    ),
  );
}

type SignInMethod = "local" | "remote";

interface SignInSession {
  providerId: string;
  session: TerminalSession;
  method: SignInMethod;
  hasAlternateMethod: boolean;
}

function AgentStepContainer({
  chrome,
  hostId,
  hostName,
  onContinue,
}: {
  chrome: StepChrome;
  hostId: string | null;
  hostName: string | null;
  onContinue: () => void;
}) {
  const statesQuery = useSystemProviderStates({
    enabled: hostId !== null,
    ...(hostId === null ? {} : { hostId }),
  });
  const providersQuery = useSystemProviders(
    hostId === null ? { enabled: false } : { hostId },
  );
  const cliStatusQuery = useHostProviderCliStatus({ hostId });
  const installRunner = useProviderCliInstallRunner();
  const { isLocalDaemonHost } = useHostDaemon();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const [signIn, setSignIn] = useState<SignInSession | null>(null);
  const [signInFailedProviderId, setSignInFailedProviderId] = useState<
    string | null
  >(null);
  const signInRef = useRef<SignInSession | null>(null);
  const { refetch: refetchStates } = statesQuery;
  const { mutate: closeTerminalMutate } = closeTerminal;
  const { mutateAsync: createTerminalAsync } = createTerminal;

  const endSignIn = useCallback(() => {
    const current = signInRef.current;
    if (current === null) return;
    signInRef.current = null;
    setSignIn(null);
    closeTerminalMutate({ mode: "force", terminalId: current.session.id });
    void refetchStates();
  }, [closeTerminalMutate, refetchStates]);

  const signInRequestRef = useRef(0);
  useEffect(
    () => () => {
      signInRequestRef.current += 1;
      endSignIn();
    },
    [endSignIn],
  );

  const handleSignInExit = useCallback(
    (exitCode: number | null) => {
      const current = signInRef.current;
      if (current !== null && exitCode !== 0) {
        setSignInFailedProviderId(current.providerId);
      }
      endSignIn();
    },
    [endSignIn],
  );

  useEffect(() => {
    if (signIn === null) return;
    const interval = window.setInterval(() => {
      void refetchStates();
    }, SIGN_IN_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refetchStates, signIn]);

  const states = statesQuery.data?.providers;
  const signingInProviderId = signIn?.providerId ?? null;
  const signingInProviderReady =
    signingInProviderId !== null &&
    states?.find((state) => state.providerId === signingInProviderId)
      ?.status === "ready";
  useEffect(() => {
    if (signingInProviderReady) endSignIn();
  }, [endSignIn, signingInProviderReady]);

  const { runningJobKey } = installRunner;
  useEffect(() => {
    if (runningJobKey === null) void refetchStates();
  }, [refetchStates, runningJobKey]);

  const startSignIn = async (
    providerId: string,
    requestedMethod?: SignInMethod,
  ) => {
    const state = states?.find((entry) => entry.providerId === providerId);
    if (hostId === null || !state) return;
    const method =
      requestedMethod ?? (isLocalDaemonHost(hostId) ? "local" : "remote");
    const command = resolveSignInCommand(state, method === "local");
    if (command === null) return;
    endSignIn();
    setSignInFailedProviderId(null);
    signInRequestRef.current += 1;
    const request = signInRequestRef.current;
    const title = `Sign in to ${state.displayName}`;
    await closeAbandonedSignInTerminals({ hostId, title });
    let session: TerminalSession;
    try {
      session = await createTerminalAsync({
        cols: SIGN_IN_TERMINAL_COLS,
        rows: SIGN_IN_TERMINAL_ROWS,
        title,
        start: { mode: "command", command },
        target: { kind: "host_path", hostId, cwd: null },
      });
    } catch {
      return;
    }
    if (signInRequestRef.current !== request) {
      void sdk.terminals
        .close({ mode: "force", terminalId: session.id })
        .catch(() => null);
      return;
    }
    const next: SignInSession = {
      providerId,
      session,
      method,
      hasAlternateMethod:
        state.localLoginCommand !== null &&
        state.loginCommand !== null &&
        state.localLoginCommand !== state.loginCommand,
    };
    signInRef.current = next;
    setSignIn(next);
  };

  const startInstall = (providerId: string) => {
    const status = cliStatusQuery.data?.[providerId];
    if (hostId === null || status === undefined) return;
    const issue = buildProviderCliIssue({ provider: providerId, status });
    if (issue === null || !hasProviderCliAction(issue)) return;
    installRunner.startInstall({ hostId, issue });
  };

  const viewInstallLog = (providerId: string) => {
    if (hostId === null) return;
    const failure = installRunner.failuresByJobKey.get(
      providerCliJobKey(hostId, providerId),
    );
    if (failure === undefined) return;
    openProviderCliInstallLog(failure.logDialogState);
  };

  const agents: OnboardingAgent[] | null =
    hostId === null || states === undefined
      ? null
      : states.map((health) => {
          const info = providersQuery.data?.find(
            (provider) => provider.id === health.providerId,
          );
          const jobKey = providerCliJobKey(hostId, health.providerId);
          const signingIn = signIn?.providerId === health.providerId;
          return {
            id: health.providerId,
            name: health.displayName,
            provider: info ?? { id: health.providerId, logoUrl: null },
            state: resolveAgentSetupState({
              health,
              cliStatus: cliStatusQuery.data?.[health.providerId],
              installing:
                installRunner.runningJobKey === jobKey ||
                installRunner.queuedJobKeys.has(jobKey),
              installFailure: installRunner.failuresByJobKey.has(jobKey)
                ? INSTALL_FAILED_MESSAGE
                : null,
              signingIn,
              signInFailed: signInFailedProviderId === health.providerId,
              installInfoPending: cliStatusQuery.isPending,
            }),
            expanded:
              signingIn && signIn !== null ? (
                <AgentSignInContainer
                  key={signIn.session.id}
                  agentName={health.displayName}
                  session={signIn.session}
                  alternate={
                    signIn.hasAlternateMethod
                      ? signIn.method === "local"
                        ? {
                            label: "Use a one-time code instead",
                            method: "remote",
                          }
                        : {
                            label: "Use browser sign-in instead",
                            method: "local",
                          }
                      : null
                  }
                  onUseAlternate={(method) =>
                    void startSignIn(health.providerId, method)
                  }
                  onExit={handleSignInExit}
                />
              ) : undefined,
          };
        });

  const agentReady = hasReadyAgent(states);
  const agentBlocked = agents === null ? statesQuery.isError : !agentReady;
  return (
    <OnboardingLayout
      {...chrome}
      step="agent"
      title="Connect a coding agent"
      description={`bb runs the agents you already use. You need one that is installed and signed in on ${
        isLocalDaemonHost(hostId)
          ? "this computer"
          : (hostName ?? "this machine")
      }.`}
      footerNote={
        agentBlocked ? "Threads can't start until one agent is ready." : null
      }
      primaryLabel="Continue"
      primaryDisabled={!agentReady}
      secondaryLabel={agentBlocked ? "Skip for now" : undefined}
      onPrimary={onContinue}
      onSecondary={onContinue}
    >
      <AgentStep
        machineName={hostName}
        agents={agents}
        onSignIn={(providerId) => void startSignIn(providerId)}
        onInstall={startInstall}
        onViewInstallLog={viewInstallLog}
        onCancelSignIn={endSignIn}
        onRecheck={() => {
          void refetchStates();
          void cliStatusQuery.refetch();
        }}
      />
    </OnboardingLayout>
  );
}

function ProjectsStepContainer({
  chrome,
  hostId,
  hostName,
  projectIdsAtOpen,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
  hostId: string | null;
  hostName: string | null;
  projectIdsAtOpen: ReadonlySet<string> | null;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const reposQuery = useHostDiscoveredRepos(hostId);
  const createProject = useCreateProject();
  const quickCreateProject = useQuickCreateProjectController();
  const navigationQuery = useSidebarNavigation();
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  const [importing, setImporting] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [now] = useState(() => Date.now());

  const { refetch: refetchRepos } = reposQuery;
  const navigationProjects = navigationQuery.data?.projects;
  const hostProjects = useMemo(
    () =>
      hostId === null
        ? []
        : (navigationProjects ?? []).flatMap((project) => {
            const source = findLocalPathProjectSourceForHost(
              project.sources,
              hostId,
            );
            return source === undefined
              ? []
              : [{ id: project.id, name: project.name, path: source.path }];
          }),
    [hostId, navigationProjects],
  );
  const scannedRepos = reposQuery.data?.repos;
  const discovered = useMemo(
    () =>
      scannedRepos?.map((repo) =>
        repo.projectId !== null
          ? repo
          : {
              ...repo,
              projectId:
                hostProjects.find((project) => project.path === repo.path)
                  ?.id ?? null,
            },
      ),
    [hostProjects, scannedRepos],
  );
  const selectedPaths = useMemo(() => {
    const importable = new Set(
      (discovered ?? [])
        .filter((repo) => repo.projectId === null)
        .map((repo) => repo.path),
    );
    const chosen = selection ?? defaultSelectedRepoPaths(discovered ?? [], now);
    return new Set([...chosen].filter((path) => importable.has(path)));
  }, [discovered, now, selection]);
  const repos = useMemo((): OnboardingRepo[] => {
    const discoveredPaths = new Set(
      (discovered ?? []).map((repo) => repo.path),
    );
    return [
      ...hostProjects
        .filter(
          (project) =>
            !discoveredPaths.has(project.path) &&
            projectIdsAtOpen !== null &&
            !projectIdsAtOpen.has(project.id),
        )
        .map((project) => ({
          id: `project:${project.id}`,
          name: project.name,
          path: project.path,
          lastActive: "",
          remote: null,
          added: true,
        })),
      ...(discovered ?? []).map((repo) => ({
        id: repo.path,
        name: repo.name,
        path: repo.path,
        lastActive: formatRelativeTime({
          timestamp: Date.parse(repo.lastActivityAt),
          now,
        }),
        remote: shortRemoteName(repo.originUrl),
        added: repo.projectId !== null,
      })),
    ];
  }, [discovered, hostProjects, now, projectIdsAtOpen]);

  const importSelected = async () => {
    if (hostId === null || discovered === undefined) return;
    const chosen = discovered.filter(
      (repo) => repo.projectId === null && selectedPaths.has(repo.path),
    );
    setImporting(true);
    try {
      for (const repo of chosen) {
        await createProject.mutateAsync({
          name: repo.name,
          source: { type: "local_path", hostId, path: repo.path },
        });
      }
    } catch {
      return;
    } finally {
      setImporting(false);
      void refetchRepos();
    }
    onContinue();
  };

  const scanning = hostId === null || reposQuery.isPending || rescanning;
  const machineLabel = hostName ?? "this computer";
  return (
    <OnboardingLayout
      {...chrome}
      step="projects"
      title="Add your projects"
      description={
        discovered === undefined ||
        discovered.every((repo) => repo.projectId !== null)
          ? `Repos you've worked in recently on ${machineLabel}.`
          : `Repos you've worked in recently on ${machineLabel}. ${
              hasRecentImportableRepo(discovered, now)
                ? "We picked this week's."
                : "We picked the most recent one."
            }`
      }
      primaryLabel={
        scanning || selectedPaths.size === 0
          ? "Continue"
          : `Import ${selectedPaths.size} ${selectedPaths.size === 1 ? "project" : "projects"}`
      }
      primaryDisabled={scanning}
      primaryBusy={importing}
      secondaryLabel="Skip"
      onPrimary={() => {
        if (selectedPaths.size === 0) onContinue();
        else void importSelected();
      }}
      onSecondary={onSkip}
      onBack={onBack}
    >
      <ProjectsStep
        status={
          scanning
            ? { kind: "scanning" }
            : reposQuery.isError
              ? {
                  kind: "error",
                  message: `bb couldn't scan ${machineLabel} for git repos.`,
                }
              : { kind: "results", truncated: reposQuery.data.truncated }
        }
        repos={repos}
        selectedIds={selectedPaths}
        onToggle={(path) => {
          const next = new Set(selectedPaths);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          setSelection(next);
        }}
        onSelectAll={() =>
          setSelection(
            new Set(
              (discovered ?? [])
                .filter((repo) => repo.projectId === null)
                .map((repo) => repo.path),
            ),
          )
        }
        onSelectNone={() => setSelection(new Set())}
        onAddFolder={quickCreateProject.openCreateDialog}
        onRetry={() => {
          setRescanning(true);
          void refetchRepos().finally(() => setRescanning(false));
        }}
      />
      <ProjectPathDialog
        target={quickCreateProject.projectPathDialog.target}
        pending={quickCreateProject.isCreating}
        platform={quickCreateProject.platform}
        hostId={quickCreateProject.hostId}
        hostName={quickCreateProject.hostName}
        hosts={quickCreateProject.hosts}
        onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
        onSubmit={quickCreateProject.submitProjectPath}
      />
    </OnboardingLayout>
  );
}

function PluginCardContainer({
  entry,
  enabled,
  onChanged,
}: {
  entry: PluginCatalogSearchEntry;
  enabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const setPluginEnabled = useSetPluginEnabled();
  const installJob = useCatalogEntryInstallJob(entry);
  const [working, setWorking] = useState(false);
  const [target, setTarget] = useState<boolean | null>(null);
  if (target !== null && target === enabled) {
    setTarget(null);
  }
  const busy = working || installJob !== null;
  const settling = target !== null && target !== enabled;
  useEffect(() => {
    if (!settling || busy) return;
    const timer = window.setTimeout(
      () => setTarget(null),
      PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [busy, settling]);

  const toggle = async (next: boolean) => {
    setTarget(next);
    setWorking(true);
    try {
      if (next && !entry.installed) {
        const job = await startCatalogPluginInstall(fetch, {
          entryId: entry.entryId,
          marketplace: entry.marketplace,
        });
        applyPluginInstallJob({ queryClient, job });
      } else {
        await setPluginEnabled(entry.pluginId, next);
      }
      await onChanged();
    } catch (error) {
      setTarget(null);
      appToast.error(
        error instanceof Error
          ? error.message
          : `Failed to update ${entry.displayName}.`,
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <OnboardingPluginCard
      name={entry.displayName}
      description={entry.description}
      icon={{
        icon: entry.icon,
        iconUrl: entry.iconUrl,
        iconTinted: entry.iconTinted,
      }}
      enabled={target ?? enabled}
      pending={busy || settling}
      unavailableReason={
        entry.installed || entry.compatible
          ? null
          : (entry.incompatibleReason ?? "Not available on this server.")
      }
      onToggle={(next) => void toggle(next)}
    />
  );
}

function PluginsStepContainer({
  chrome,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const listQuery = usePluginList({ enabled: true });
  const { refetch: refetchCatalog } = catalogQuery;
  const { refetch: refetchList } = listQuery;
  const refresh = useCallback(async () => {
    await Promise.all([refetchCatalog(), refetchList()]);
  }, [refetchCatalog, refetchList]);

  const installedPlugins = listQuery.data?.plugins;
  const installedCount = installedPlugins?.length ?? 0;
  useEffect(() => {
    void refetchCatalog();
  }, [installedCount, refetchCatalog]);

  const entries = useMemo(() => {
    const all = catalogQuery.data?.entries;
    if (all === undefined) return null;
    return ONBOARDING_PLUGINS.flatMap(({ entryId, description }) => {
      const entry = all.find(
        (candidate) =>
          candidate.marketplace === ONBOARDING_PLUGIN_MARKETPLACE &&
          candidate.entryId === entryId,
      );
      return entry === undefined ? [] : [{ ...entry, description }];
    });
  }, [catalogQuery.data?.entries]);

  return (
    <OnboardingLayout
      {...chrome}
      step="plugins"
      title="Give your agents more to work with"
      description="Optional, and off until you turn them on. You can change them anytime in Plugins."
      primaryLabel="Continue"
      secondaryLabel="Skip"
      onPrimary={onContinue}
      onSecondary={onSkip}
      onBack={onBack}
    >
      <OnboardingPluginGrid compact={chrome.compact}>
        {entries === null ? (
          <OnboardingPluginGridSkeleton count={ONBOARDING_PLUGINS.length} />
        ) : (
          entries.map((entry) => (
            <PluginCardContainer
              key={entry.entryId}
              entry={entry}
              enabled={
                entry.installed &&
                (installedPlugins?.find(
                  (plugin) => plugin.id === entry.pluginId,
                )?.enabled ??
                  false)
              }
              onChanged={refresh}
            />
          ))
        )}
      </OnboardingPluginGrid>
    </OnboardingLayout>
  );
}

function detectMobilePlatform(): "ios" | "android" | null {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPad|iPod/u.test(userAgent)) return "ios";
  if (/Android/u.test(userAgent)) return "android";
  return null;
}

function DevicesStepContainer({
  chrome,
  hostId,
  onBack,
  onFinish,
  onLeave,
}: {
  chrome: StepChrome;
  hostId: string | null;
  onBack: () => void;
  onFinish: () => void;
  onLeave: () => void;
}) {
  const configQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const [connectSetupOpen, setConnectSetupOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [mobilePlatform] = useState(detectMobilePlatform);
  const location = useLocation();
  const [initialPathname] = useState(location.pathname);
  const navigatedAway = location.pathname !== initialPathname;
  useEffect(() => {
    if (navigatedAway) onLeave();
  }, [navigatedAway, onLeave]);
  const otherMachineCount = (hostsQuery.data ?? []).filter(
    (host) => host.id !== hostId,
  ).length;

  return (
    <OnboardingLayout
      {...chrome}
      step="devices"
      title="Check on agents away from your desk"
      description="Optional. Also in Settings → Machines."
      primaryLabel="Start your first thread"
      onPrimary={onFinish}
      onBack={onBack}
    >
      <DevicesStep
        connect={connectAccessUrl(configQuery.data?.serverAccess)}
        connectSetup={<PluginSettingsSections pluginId={CONNECT_PLUGIN_ID} />}
        connectSetupOpen={connectSetupOpen}
        otherMachineCount={otherMachineCount}
        mobileLinks={mobileAppDownloads}
        mobilePlatform={mobilePlatform}
        showMobileApp={!isInsideNativeShell()}
        onToggleConnectSetup={() => setConnectSetupOpen((open) => !open)}
        onCopyConnectUrl={(url) => void copyToClipboardWithToast(url)}
        onAddMachine={() => setAddMachineOpen(true)}
      />
      <AddMachineDialog
        open={addMachineOpen}
        onOpenChange={setAddMachineOpen}
      />
    </OnboardingLayout>
  );
}

const STEP_ORDER: readonly OnboardingStepId[] = [
  "agent",
  "projects",
  "plugins",
  "devices",
];

export function OnboardingFlow({
  initialStep,
  entry,
  onClose,
}: {
  initialStep: OnboardingStepId;
  entry: OnboardingEntry;
  onClose: () => void;
}) {
  const [step, setStep] = useState(initialStep);
  const navigationProjects = useSidebarNavigation().data?.projects;
  const [projectIdsAtOpen, setProjectIdsAtOpen] =
    useState<ReadonlySet<string> | null>(null);
  if (projectIdsAtOpen === null && navigationProjects !== undefined) {
    setProjectIdsAtOpen(
      new Set(navigationProjects.map((project) => project.id)),
    );
  }
  const primaryHost = usePrimaryHost();
  const hostId = primaryHost?.id ?? null;
  useHostDiscoveredRepos(hostId);
  const agentStates = useSystemProviderStates({
    enabled: hostId !== null,
    poll: false,
    ...(hostId === null ? {} : { hostId }),
  }).data?.providers;
  const startReportedRef = useRef(entry !== "first_run");
  useEffect(() => {
    if (startReportedRef.current || agentStates === undefined) return;
    startReportedRef.current = true;
    recordTelemetryEvent({
      name: "onboarding_started",
      properties: {
        agent_installed: agentStates.some(
          (state) =>
            state.status !== "not_installed" && state.status !== "unknown",
        ),
        agent_ready: hasReadyAgent(agentStates),
      },
    });
  }, [agentStates]);
  const reachedStepsRef = useRef(new Set<OnboardingStepId>());
  useEffect(() => {
    if (reachedStepsRef.current.has(step)) return;
    reachedStepsRef.current.add(step);
    recordTelemetryEvent({
      name: "onboarding_step_reached",
      properties: { step, entry },
    });
  }, [entry, step]);
  const finishedRef = useRef(false);
  const close = (outcome: "completed" | "skipped") => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (outcome === "skipped") {
      recordTelemetryEvent({
        name: "onboarding_step_skipped",
        properties: { step, entry },
      });
    } else {
      recordTelemetryEvent({
        name: "onboarding_step_completed",
        properties: { step, entry },
      });
    }
    recordTelemetryEvent({
      name: "onboarding_finished",
      properties: { outcome, entry, last_step: step },
    });
    onClose();
  };
  const compact = useMediaQuery("(max-width: 640px)");
  const [desktopInfo] = useState(getBbDesktopInfo);
  const windowState = useDesktopWindowState();
  const chrome: StepChrome = {
    compact,
    reserveMacosTrafficLights: shouldReserveMacosTrafficLights({
      desktopInfo,
      windowState,
    }),
    onSelectStep: setStep,
    onSkipAll: () => close("skipped"),
  };
  const goTo = (offset: number) => () => {
    const next = STEP_ORDER[STEP_ORDER.indexOf(step) + offset];
    if (next !== undefined) setStep(next);
  };
  const advance = (outcome: "completed" | "skipped") => () => {
    recordTelemetryEvent({
      name:
        outcome === "completed"
          ? "onboarding_step_completed"
          : "onboarding_step_skipped",
      properties: { step, entry },
    });
    goTo(1)();
  };

  switch (step) {
    case "agent":
      return (
        <AgentStepContainer
          chrome={chrome}
          hostId={hostId}
          hostName={primaryHost?.name ?? null}
          onContinue={advance(
            hasReadyAgent(agentStates) ? "completed" : "skipped",
          )}
        />
      );
    case "projects":
      return (
        <ProjectsStepContainer
          chrome={chrome}
          hostId={hostId}
          hostName={primaryHost?.name ?? null}
          projectIdsAtOpen={projectIdsAtOpen}
          onBack={goTo(-1)}
          onContinue={advance("completed")}
          onSkip={advance("skipped")}
        />
      );
    case "plugins":
      return (
        <PluginsStepContainer
          chrome={chrome}
          onBack={goTo(-1)}
          onContinue={advance("completed")}
          onSkip={advance("skipped")}
        />
      );
    case "devices":
      return (
        <DevicesStepContainer
          chrome={chrome}
          hostId={hostId}
          onBack={goTo(-1)}
          onFinish={() => close("completed")}
          onLeave={() => close("skipped")}
        />
      );
  }
}
