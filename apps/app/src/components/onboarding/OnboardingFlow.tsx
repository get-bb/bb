import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useLocation } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  isActiveTerminalSessionStatus,
  mobileAppDownloads,
} from "@bb/domain";
import type { TerminalOutputChunk, TerminalSession } from "@bb/server-contract";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import {
  AddMachineDialog,
  AddMachineInline,
} from "@/components/dialogs/AddMachineDialog";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { machineServerAccessReady } from "@/components/machines/machine-server-access";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { PluginSetupGuideSections } from "@/components/plugin/PluginSetupGuideSections";
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
import {
  useHostDiscoveredRepos,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import {
  pluginCatalogSearchQueryOptions,
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { useCatalogEntryInstallJob } from "@/hooks/queries/plugin-install-job-queries";
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
import { decodeBase64Bytes } from "@/lib/base64-bytes";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { sdk } from "@/lib/sdk";
import { formatRelativeTime } from "@/lib/relative-time";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  AgentInstallErrorDetails,
  AgentSignInInstruction,
  type AgentSignInView,
  AgentSignInGuide,
  AgentSignInPanel,
  AgentStep,
  DevicesStep,
  OnboardingLayout,
  OnboardingPluginCard,
  OnboardingPluginGrid,
  OnboardingPluginGridSkeleton,
  ProjectsStep,
  ConnectUnavailableRow,
  RedesignedDevicesStep,
  type OnboardingAgent,
  type OnboardingRepo,
} from "./OnboardingViews";
import {
  CONNECT_PLUGIN_ID,
  ONBOARDING_PLUGIN_MARKETPLACE,
  ONBOARDING_STEPS,
  STEP_COPY,
  connectAccessUrl,
  defaultSelectedRepoPaths,
  agentContinueDisabled,
  featuredPluginEntryIds,
  hasReadyAgent,
  operationFailureReason,
  parseSignInOutput,
  projectsPrimaryAction,
  resolveAgentSetupState,
  shortRemoteName,
  skippedStepIds,
  terminalConnectFlow,
  type OnboardingStepId,
  type TerminalConnectFlow,
  type SetupGuide,
  type StepOutcome,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";
import { useDeviceSetupTracking } from "./useDeviceSetupTracking";
import { useAgentStateTelemetry } from "./useAgentStateTelemetry";
import { useLoadFailureTelemetry } from "./useLoadFailureTelemetry";
import { useOnboardingPluginChange } from "./useOnboardingPluginChange";
import { useProjectsScanTelemetry } from "./useProjectsScanTelemetry";
import { useOnboardingProjectImport } from "./useOnboardingProjectImport";
import { useSendAfterFirstOutput } from "./useSendAfterFirstOutput";
import {
  useAgentSignIns,
  type AgentSignInTerminals,
  type SignInMethod,
} from "./useAgentSignIns";

const SIGN_IN_TERMINAL_COLS = 200;
const SIGN_IN_TERMINAL_ROWS = 14;
const SIGN_IN_OUTPUT_POLL_INTERVAL_MS = 1_000;
const SIGN_IN_OUTPUT_TAIL_BYTES = 64 * 1024;
const SIGN_IN_TERMINAL_FALLBACK_DELAY_MS = 6_000;
const REDESIGN_SIGN_IN_TERMINAL_FALLBACK_DELAY_MS = 3_000;
const CONNECT_INPUT_SETTLE_MS = 500;
const INSTALL_SETTLE_TIMEOUT_MS = 20_000;
const INSTALL_SETTLE_POLL_MS = 2_000;
const INSTALL_FAILED_MESSAGE = "Install failed";
const REDESIGN_INSTALL_FAILED_MESSAGE =
  "Couldn't install. Check your connection and retry.";
const PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS = 10_000;
const ONBOARDING_PHONE_QUERY = "(max-width: 640px) and (pointer: coarse)";
const ONBOARDING_COMPACT_QUERY = "(max-width: 640px)";

function stepCopy(redesign: boolean, step: OnboardingStepId) {
  return STEP_COPY[redesign ? "new" : "control"][step];
}

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
  redesign,
  connectFlow,
  agentName,
  session,
  alternate,
  onUseAlternate,
  onExit,
  onViewChange,
}: {
  redesign: boolean;
  connectFlow: TerminalConnectFlow | null;
  onViewChange: (view: AgentSignInView) => void;
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
      redesign
        ? REDESIGN_SIGN_IN_TERMINAL_FALLBACK_DELAY_MS
        : SIGN_IN_TERMINAL_FALLBACK_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [redesign]);
  const terminalVisible =
    terminalChoice ??
    (connectFlow !== null ||
      (fallbackDue && (guide === null || guide.url === null)));
  const started =
    guide?.url != null ||
    fallbackDue ||
    terminalChoice !== null ||
    connectFlow !== null;
  const view = useMemo(
    () => ({ guide, terminalVisible, started }),
    [guide, terminalVisible, started],
  );
  useEffect(() => {
    onViewChange(view);
  }, [onViewChange, view]);
  useSendAfterFirstOutput({
    enabled: connectFlow !== null,
    hasOutput: (output?.chunks.length ?? 0) > 0,
    settleMs: CONNECT_INPUT_SETTLE_MS,
    send: () => {
      if (connectFlow === null) return;
      void sdk.terminals
        .input({
          terminalId: session.id,
          dataBase64: encodeTerminalInput(connectFlow.input),
        })
        .catch(() => undefined);
    },
  });

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

  const terminal = (
    <ThreadTerminalView autoFocus={false} isPanelOpen session={session} />
  );
  if (redesign) {
    return (
      <AgentSignInPanel
        connect={connectFlow !== null}
        agentName={agentName}
        view={view}
        code={code}
        codeSubmitted={codeSubmitted}
        terminal={terminal}
        onCodeChange={(next) => {
          setCode(next);
          setCodeSubmitted(false);
        }}
        onSubmitCode={submitCode}
        onCopy={(text) => void copyToClipboardWithToast(text)}
        onToggleTerminal={() => setTerminalChoice(!terminalVisible)}
      />
    );
  }
  return (
    <AgentSignInGuide
      agentName={agentName}
      guide={guide}
      code={code}
      codeSubmitted={codeSubmitted}
      terminalVisible={terminalVisible}
      terminal={terminal}
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
  composition: "docked" | "centered";
  showSkipAll: boolean;
  skippedSteps: ReadonlySet<OnboardingStepId>;
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

function AgentStepContainer({
  chrome,
  redesign,
  entry,
  hostId,
  noHost,
  hostName,
  onContinue,
}: {
  chrome: StepChrome;
  redesign: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  noHost: boolean;
  hostName: string | null;
  onContinue: () => void;
}) {
  const statesQuery = useSystemProviderStates({
    enabled: hostId !== null,
    ...(hostId === null ? {} : { hostId }),
  });
  useLoadFailureTelemetry({ entry, step: "agent", noHost, query: statesQuery });
  const providersQuery = useSystemProviders(
    hostId === null ? { enabled: false } : { hostId },
  );
  const cliStatusQuery = useHostProviderCliStatus({ hostId });
  const installRunner = useProviderCliInstallRunner();
  const { isLocalDaemonHost } = useHostDaemon();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const { refetch: refetchStates } = statesQuery;
  const { mutate: closeTerminalMutate } = closeTerminal;
  const { mutateAsync: createTerminalAsync } = createTerminal;
  const states = statesQuery.data?.providers;
  const refetchProviderStates = useCallback(() => {
    void refetchStates();
  }, [refetchStates]);
  const signInTerminals = useMemo<AgentSignInTerminals>(
    () => ({
      closeAbandoned: closeAbandonedSignInTerminals,
      create: ({ hostId: targetHostId, title, command }) =>
        createTerminalAsync({
          cols: SIGN_IN_TERMINAL_COLS,
          rows: SIGN_IN_TERMINAL_ROWS,
          title,
          start: { mode: "command", command },
          target: { kind: "host_path", hostId: targetHostId, cwd: null },
        }),
      close: (terminalId) => closeTerminalMutate({ mode: "force", terminalId }),
    }),
    [closeTerminalMutate, createTerminalAsync],
  );
  const signIns = useAgentSignIns({
    concurrent: redesign,
    entry,
    hostId,
    states,
    isLocalHost: isLocalDaemonHost,
    terminals: signInTerminals,
    refetchStates: refetchProviderStates,
  });
  const startSignIn = signIns.start;

  const { runningJobKey } = installRunner;
  useEffect(() => {
    if (runningJobKey === null) void refetchStates();
  }, [refetchStates, runningJobKey]);

  const previousRunningJobKeyRef = useRef<string | null>(null);
  const [settlingJobKeys, setSettlingJobKeys] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const installFailures = installRunner.failuresByJobKey;
  useEffect(() => {
    const previous = previousRunningJobKeyRef.current;
    previousRunningJobKeyRef.current = runningJobKey;
    if (!redesign || previous === null || previous === runningJobKey) return;
    if (installFailures.has(previous)) return;
    setSettlingJobKeys((keys) =>
      new Map(keys).set(previous, Date.now() + INSTALL_SETTLE_TIMEOUT_MS),
    );
  }, [installFailures, redesign, runningJobKey]);
  const settlingCount = settlingJobKeys.size;
  useEffect(() => {
    if (settlingCount === 0) return;
    const poll = window.setInterval(() => {
      void refetchStates();
      const now = Date.now();
      setSettlingJobKeys((keys) => {
        const live = [...keys].filter(([, deadline]) => deadline > now);
        return live.length === keys.size ? keys : new Map(live);
      });
    }, INSTALL_SETTLE_POLL_MS);
    return () => window.clearInterval(poll);
  }, [refetchStates, settlingCount]);

  const startInstall = (providerId: string) => {
    const status = cliStatusQuery.data?.[providerId];
    if (hostId === null || status === undefined) return;
    const issue = buildProviderCliIssue({ provider: providerId, status });
    if (issue === null || !hasProviderCliAction(issue)) return;
    installRunner.startInstall({ hostId, issue, onboardingEntry: entry });
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
          const signIn = signIns.signIns.get(health.providerId) ?? null;
          const signingIn = signIn !== null;
          const installFailure = installRunner.failuresByJobKey.get(jobKey);
          const connectFlow = redesign
            ? terminalConnectFlow(health.providerId)
            : null;
          const view = signIns.views.get(health.providerId) ?? null;
          const instructionReady =
            view !== null && connectFlow === null && view.started;
          return {
            id: health.providerId,
            name: health.displayName,
            provider: info ?? { id: health.providerId, logoUrl: null },
            setup: connectFlow !== null ? "connect" : "signIn",
            installQueued: redesign && installRunner.queuedJobKeys.has(jobKey),
            busy:
              redesign &&
              (signIns.startingProviderIds.has(health.providerId) ||
                (signingIn && connectFlow === null && !instructionReady)),
            subline:
              redesign &&
              signIn !== null &&
              view !== null &&
              instructionReady ? (
                <AgentSignInInstruction
                  agentName={health.displayName}
                  view={view}
                  alternate={
                    signIn.hasAlternateMethod
                      ? signIn.method === "local"
                        ? "code"
                        : "browser"
                      : null
                  }
                  onOpenUrl={openUrlInExternalBrowser}
                  onUseAlternate={() =>
                    void startSignIn(
                      health.providerId,
                      signIn.method === "local" ? "remote" : "local",
                    )
                  }
                />
              ) : undefined,
            state: resolveAgentSetupState({
              health,
              cliStatus: cliStatusQuery.data?.[health.providerId],
              installing:
                installRunner.runningJobKey === jobKey ||
                installRunner.queuedJobKeys.has(jobKey) ||
                (settlingJobKeys.has(jobKey) &&
                  (health.status === "not_installed" ||
                    health.status === "unsupported_version")),
              installFailure:
                installFailure === undefined
                  ? null
                  : redesign
                    ? REDESIGN_INSTALL_FAILED_MESSAGE
                    : INSTALL_FAILED_MESSAGE,
              signingIn,
              signInFailed: signIns.failedProviderIds.has(health.providerId),
              installInfoPending: cliStatusQuery.isPending,
            }),
            expanded:
              signingIn && signIn !== null ? (
                <AgentSignInContainer
                  key={signIn.session.id}
                  redesign={redesign}
                  connectFlow={connectFlow}
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
                  onExit={(exitCode) =>
                    signIns.handleExit(health.providerId, exitCode)
                  }
                  onViewChange={(nextView) =>
                    signIns.setView(health.providerId, nextView)
                  }
                />
              ) : redesign && installFailure !== undefined ? (
                <AgentInstallErrorDetails
                  log={installFailure.logDialogState.log}
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
      {...stepCopy(redesign, "agent")}
      footerNote={
        agentBlocked && !redesign
          ? "Threads can't start until one agent is ready."
          : null
      }
      primaryDisabled={agentContinueDisabled({
        redesign,
        agentReady,
        statesLoading:
          hostId !== null && states === undefined && !statesQuery.isError,
      })}
      secondaryLabel={agentBlocked && !redesign ? "Skip for now" : undefined}
      onPrimary={onContinue}
      onSecondary={onContinue}
    >
      <AgentStep
        quiet={redesign}
        machineName={hostName}
        agents={agents}
        onSignIn={(providerId) => void startSignIn(providerId)}
        onInstall={startInstall}
        onViewInstallLog={viewInstallLog}
        onCancelSignIn={(providerId) => signIns.end(providerId)}
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
  redesign,
  entry,
  hostId,
  projectIdsAtOpen,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
  redesign: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  projectIdsAtOpen: ReadonlySet<string> | null;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const reposQuery = useHostDiscoveredRepos(hostId);
  const quickCreateProject = useQuickCreateProjectController();
  const navigationQuery = useSidebarNavigation();
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [now] = useState(() => Date.now());

  const { refetch: refetchRepos } = reposQuery;
  const { importing, importProjects } = useOnboardingProjectImport({
    entry,
    onContinue,
    onSettled: () => void refetchRepos(),
  });
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

  const recordFolderAdd = (
    result:
      | { outcome: "started" | "succeeded" }
      | { outcome: "failed"; error: unknown },
  ) =>
    recordTelemetryEvent({
      name: "onboarding_operation",
      properties: {
        entry,
        step: "projects",
        operation: "import",
        outcome: result.outcome,
        item_count: 1,
        succeeded_count: result.outcome === "succeeded" ? 1 : 0,
        ...(result.outcome === "failed"
          ? { failure_reason: operationFailureReason(result.error) }
          : {}),
      },
    });
  const addFolder = () =>
    quickCreateProject.openObservedCreateDialog({
      onStarted: () => recordFolderAdd({ outcome: "started" }),
      onSettled: recordFolderAdd,
    });

  const importSelected = () => {
    if (hostId === null || discovered === undefined) return;
    const chosen = discovered.filter(
      (repo) => repo.projectId === null && selectedPaths.has(repo.path),
    );
    void importProjects(hostId, chosen);
  };

  const scanning = hostId === null || reposQuery.isPending || rescanning;
  const copy = stepCopy(redesign, "projects");
  return (
    <OnboardingLayout
      {...chrome}
      step="projects"
      title={copy.title}
      description={copy.description}
      primaryLabel={
        scanning || selectedPaths.size === 0
          ? copy.primaryLabel
          : `Import ${selectedPaths.size} ${selectedPaths.size === 1 ? "project" : "projects"}`
      }
      primaryDisabled={scanning}
      primaryBusy={importing}
      secondaryLabel={redesign ? undefined : "Skip"}
      onPrimary={() => {
        const action = projectsPrimaryAction({
          selectedCount: selectedPaths.size,
          existingProjectIds: projectIdsAtOpen,
          projectIds: hostProjects.map((project) => project.id),
        });
        if (action === "import") importSelected();
        else if (action === "completed") onContinue();
        else onSkip();
      }}
      onSecondary={onSkip}
      onBack={onBack}
    >
      <ProjectsStep
        selection={redesign ? "header" : "line"}
        status={
          scanning
            ? { kind: "scanning" }
            : reposQuery.isError
              ? {
                  kind: "error",
                  message: "bb couldn't scan this computer for git repos.",
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
        onAddFolder={addFolder}
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
  onboardingEntry,
  entry,
  compact,
  enabled,
  onChanged,
  onSelected,
  onDeselected,
}: {
  onboardingEntry: OnboardingEntry;
  entry: PluginCatalogSearchEntry;
  compact: boolean;
  enabled: boolean;
  onChanged: () => Promise<void>;
  onSelected: () => void;
  onDeselected: () => void;
}) {
  const changePlugin = useOnboardingPluginChange({
    onboardingEntry,
    plugin: entry,
  });
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
    if (next) onSelected();
    else onDeselected();
    setTarget(next);
    setWorking(true);
    try {
      await changePlugin(next);
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
      density={compact ? "compact" : "default"}
      showStateLabel={!compact}
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
  setupGuide,
  entry: onboardingEntry,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
  setupGuide: SetupGuide;
  entry: OnboardingEntry;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  useLoadFailureTelemetry({
    entry: onboardingEntry,
    step: "plugins",
    noHost: false,
    query: catalogQuery,
  });
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

  const redesign = setupGuide.variant === "new";
  const entryIds = useMemo(
    () => featuredPluginEntryIds(setupGuide),
    [setupGuide],
  );
  const entries = useMemo(() => {
    const all = catalogQuery.data?.entries;
    if (all === undefined) return null;
    return entryIds.flatMap((entryId) => {
      const entry = all.find(
        (candidate) =>
          candidate.marketplace === ONBOARDING_PLUGIN_MARKETPLACE &&
          candidate.entryId === entryId,
      );
      return entry === undefined ? [] : [entry];
    });
  }, [catalogQuery.data?.entries, entryIds]);
  const isEnabled = (entry: PluginCatalogSearchEntry) =>
    entry.installed &&
    (installedPlugins?.find((plugin) => plugin.id === entry.pluginId)
      ?.enabled ??
      false);

  const [recommendationIds] = useState(() => new Map<string, string>());
  const recordRecommendation = useCallback(
    (pluginId: string, action: "shown" | "selected" | "deselected") => {
      let recommendationId = recommendationIds.get(pluginId);
      if (recommendationId === undefined) {
        recommendationId = nanoid();
        recommendationIds.set(pluginId, recommendationId);
      }
      recordTelemetryEvent({
        name: "recommendation",
        properties: {
          resource_type: "plugin",
          resource_id: pluginId,
          recommendation_id: recommendationId,
          action,
          surface: "onboarding",
          entry: onboardingEntry,
        },
      });
    },
    [onboardingEntry, recommendationIds],
  );
  useEffect(() => {
    for (const entry of entries ?? []) {
      if (!recommendationIds.has(entry.pluginId)) {
        recordRecommendation(entry.pluginId, "shown");
      }
    }
  }, [entries, recommendationIds, recordRecommendation]);

  return (
    <OnboardingLayout
      {...chrome}
      step="plugins"
      width={redesign ? "wide" : "default"}
      {...stepCopy(redesign, "plugins")}
      secondaryLabel={redesign ? undefined : "Skip"}
      onPrimary={() => {
        if (!(entries ?? []).some(isEnabled)) onSkip();
        else onContinue();
      }}
      onSecondary={onSkip}
      onBack={onBack}
    >
      <OnboardingPluginGrid compact={chrome.compact} showHelp={!redesign}>
        {entries === null ? (
          <OnboardingPluginGridSkeleton count={entryIds.length} />
        ) : (
          entries.map((entry) => (
            <PluginCardContainer
              key={entry.entryId}
              onboardingEntry={onboardingEntry}
              entry={entry}
              compact={redesign}
              enabled={isEnabled(entry)}
              onChanged={refresh}
              onSelected={() =>
                recordRecommendation(entry.pluginId, "selected")
              }
              onDeselected={() =>
                recordRecommendation(entry.pluginId, "deselected")
              }
            />
          ))
        )}
      </OnboardingPluginGrid>
    </OnboardingLayout>
  );
}

function DevicesStepContainer({
  chrome,
  redesign,
  entry,
  hostId,
  hostName,
  onBack,
  onFinish,
  onLeave,
}: {
  chrome: StepChrome;
  redesign: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  hostName: string | null;
  onBack: () => void;
  onFinish: () => void;
  onLeave: () => void;
}) {
  const configQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const [connectSetupOpen, setConnectSetupOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const onPhone = useMediaQuery(ONBOARDING_PHONE_QUERY);
  const location = useLocation();
  const [initialPathname] = useState(location.pathname);
  const navigatedAway = location.pathname !== initialPathname;
  useEffect(() => {
    if (navigatedAway) onLeave();
  }, [navigatedAway, onLeave]);
  const otherMachineCount = (hostsQuery.data ?? []).filter(
    (host) => host.id !== hostId,
  ).length;
  const connect = connectAccessUrl(configQuery.data?.serverAccess);
  const connectedMachineCount = hostsQuery.data?.filter(
    (host) => host.id !== hostId && host.status === "connected",
  ).length;
  const { startRemoteAccessSetup, failRemoteAccessSetup, failAddMachine } =
    useDeviceSetupTracking({
      entry,
      connectStatus: connect.status,
      addMachineCommandShown:
        addMachineOpen &&
        (redesign
          ? connect.status === "on"
          : machineServerAccessReady(configQuery.data?.serverAccess)),
      connectedMachineCount,
    });
  const addMachine = () => setAddMachineOpen(true);
  const closeAddMachine = () => {
    void hostsQuery.refetch();
    setAddMachineOpen(false);
  };
  if (redesign) {
    return (
      <OnboardingLayout
        {...chrome}
        step="devices"
        width="wide"
        {...stepCopy(redesign, "devices")}
        onPrimary={onFinish}
        onBack={onBack}
      >
        <RedesignedDevicesStep
          hostName={hostName}
          showMachines={connect.status === "on"}
          connectSection={
            <PluginSetupGuideSections
              pluginId={CONNECT_PLUGIN_ID}
              onPhone={onPhone}
              onSetupStarted={startRemoteAccessSetup}
              onSetupFailed={failRemoteAccessSetup}
              fallback={<ConnectUnavailableRow />}
            />
          }
          addMachinePanel={
            addMachineOpen && connect.status === "on" ? (
              <AddMachineInline onEnrollmentFailed={failAddMachine} />
            ) : null
          }
          onAddMachine={addMachine}
          onCloseAddMachine={closeAddMachine}
        />
      </OnboardingLayout>
    );
  }
  return (
    <OnboardingLayout
      {...chrome}
      step="devices"
      {...stepCopy(redesign, "devices")}
      onPrimary={onFinish}
      onBack={onBack}
    >
      <DevicesStep
        connect={connect}
        connectSetup={
          <PluginSettingsSections
            pluginId={CONNECT_PLUGIN_ID}
            onSetupStarted={startRemoteAccessSetup}
            onSetupFailed={failRemoteAccessSetup}
          />
        }
        connectSetupOpen={connectSetupOpen}
        otherMachineCount={otherMachineCount}
        mobileLinks={mobileAppDownloads}
        onToggleConnectSetup={() => setConnectSetupOpen((open) => !open)}
        onCopyConnectUrl={(url) => void copyToClipboardWithToast(url)}
        onAddMachine={addMachine}
      />
      <AddMachineDialog
        open={addMachineOpen}
        onOpenChange={setAddMachineOpen}
        onEnrollmentFailed={failAddMachine}
      />
    </OnboardingLayout>
  );
}

const STEP_ORDER: readonly OnboardingStepId[] = ONBOARDING_STEPS.map(
  (entry) => entry.id,
);

export function OnboardingFlow({
  initialStep,
  entry,
  setupGuide,
  onClose,
}: {
  initialStep: OnboardingStepId;
  entry: OnboardingEntry;
  setupGuide: SetupGuide;
  onClose: (lastStep: OnboardingStepId) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const redesign = setupGuide.variant === "new";
  const [stepOutcomes, setStepOutcomes] = useState<
    ReadonlyMap<OnboardingStepId, StepOutcome>
  >(() => new Map());
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.prefetchQuery(pluginCatalogSearchQueryOptions(""));
  }, [queryClient]);
  const exposedRef = useRef(false);
  useEffect(() => {
    if (exposedRef.current) return;
    exposedRef.current = true;
    recordTelemetryEvent({ name: "onboarding_exposed", properties: { entry } });
  }, [entry]);
  const navigationProjects = useSidebarNavigation().data?.projects;
  const [projectIdsAtOpen, setProjectIdsAtOpen] =
    useState<ReadonlySet<string> | null>(null);
  if (projectIdsAtOpen === null && navigationProjects !== undefined) {
    setProjectIdsAtOpen(
      new Set(navigationProjects.map((project) => project.id)),
    );
  }
  const hostsLoaded = useHosts().data !== undefined;
  const primaryHost = usePrimaryHost();
  const hostId = primaryHost?.id ?? null;
  const reposQuery = useHostDiscoveredRepos(hostId);
  const noHost = hostsLoaded && primaryHost === null;
  useProjectsScanTelemetry({
    entry,
    scan: reposQuery,
    noHost: step === "projects" && noHost,
  });
  const agentStatesQuery = useSystemProviderStates({
    enabled: hostId !== null,
    poll: false,
    ...(hostId === null ? {} : { hostId }),
  });
  const agentStates = agentStatesQuery.data?.providers;
  useAgentStateTelemetry({
    entry,
    states: agentStates,
    isError: agentStatesQuery.isError,
  });
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
    onClose(step);
  };
  const compact = useMediaQuery(ONBOARDING_COMPACT_QUERY);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const windowState = useDesktopWindowState();
  const chrome: StepChrome = {
    compact,
    reserveMacosTrafficLights: shouldReserveMacosTrafficLights({
      desktopInfo,
      windowState,
    }),
    composition: redesign ? "centered" : "docked",
    showSkipAll: !redesign,
    skippedSteps: redesign ? skippedStepIds(stepOutcomes) : new Set(),
    onSelectStep: setStep,
    onSkipAll: () => close("skipped"),
  };
  const goTo = (offset: number) => () => {
    const next = STEP_ORDER[STEP_ORDER.indexOf(step) + offset];
    if (next !== undefined) setStep(next);
  };
  const advance = (outcome: StepOutcome) => () => {
    setStepOutcomes((current) => new Map(current).set(step, outcome));
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
          redesign={redesign}
          entry={entry}
          hostId={hostId}
          noHost={noHost}
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
          redesign={redesign}
          entry={entry}
          hostId={hostId}
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
          setupGuide={setupGuide}
          entry={entry}
          onBack={goTo(-1)}
          onContinue={advance("completed")}
          onSkip={advance("skipped")}
        />
      );
    case "devices":
      return (
        <DevicesStepContainer
          chrome={chrome}
          redesign={redesign}
          entry={entry}
          hostId={hostId}
          hostName={primaryHost?.name ?? null}
          onBack={goTo(-1)}
          onFinish={() => close("completed")}
          onLeave={() => close("skipped")}
        />
      );
  }
}
