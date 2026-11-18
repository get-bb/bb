import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useLocation } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  isActiveTerminalSessionStatus,
} from "@bb/domain";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type { TerminalOutputChunk, TerminalSession } from "@bb/server-contract";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { AddMachineInline } from "@/components/dialogs/AddMachineDialog";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { PluginSetupGuideSections } from "@/components/plugin/PluginSetupGuideSections";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { ThreadTerminalView } from "@/components/thread/terminal/ThreadTerminalView";
import { appToast } from "@/components/ui/app-toast";
import { setToasterCompactPlacement } from "@/components/ui/app-toast-runtime";
import { restartSystemProviderStatesLoad } from "@/hooks/cache-owners/system-cache-effects";
import { useRefetchAfterFirstLoad } from "./useRefetchAfterFirstLoad";
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
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { terminalOutputTailQueryKey } from "@/hooks/queries/query-keys";
import {
  hostProviderCliStatusQueryOptions,
  useHostProviderCliStatus,
  useSystemConfig,
  recheckHostProviderStates,
  useHostProviderStatesAsTheyLoad,
  useSystemProviderCatalog,
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
  AgentSignInInstruction,
  AgentSignInPanel,
  AgentStep,
  DevicesStep,
  OnboardingLayout,
  OnboardingPluginCard,
  OnboardingPluginGrid,
  OnboardingPluginGridSkeleton,
  ProjectsStep,
  type AgentLoadingRow,
  type OnboardingAgent,
  type OnboardingRepo,
} from "./OnboardingViews";
import {
  CONNECT_PLUGIN_ID,
  ONBOARDING_PLUGIN_MARKETPLACE,
  ONBOARDING_STEPS,
  STEP_COPY,
  connectAccessUrl,
  devicesShowMachines,
  agentRowSetup,
  connectFlowFailed,
  defaultSelectedRepoPaths,
  ONBOARDING_PLUGIN_ENTRY_IDS,
  agentCheckFailedMessage,
  agentListFailedMessage,
  agentListFailure,
  failedAgentProviderIds,
  resolveAgentRows,
  hasReadyAgent,
  operationFailureReason,
  projectsPrimaryAction,
  resolveAgentSetupState,
  setupGuidePlanHealth,
  signInBrowserIsOnMachine,
  shortRemoteName,
  skippedStepIds,
  terminalConnectFlow,
  agentSignInView,
  type AgentSignInView,
  type OnboardingStepId,
  type TerminalConnectFlow,
  type StepOutcome,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";
import { useDeviceSetupTracking } from "./useDeviceSetupTracking";
import { useAgentStateTelemetry } from "./useAgentStateTelemetry";
import { useLoadTelemetry, type StepLoadRecords } from "./useLoadTelemetry";
import { useOnboardingLeftTelemetry } from "./useOnboardingLeftTelemetry";
import { useOnboardingErrorStep } from "./OnboardingErrorTelemetry";
import {
  useOnboardingPluginChange,
  useOnboardingPluginInstallOutcomes,
  type TrackPluginInstall,
} from "./useOnboardingPluginChange";
import {
  useOnboardingPluginSwitches,
  type OnboardingPluginSwitches,
} from "./useOnboardingPluginSwitches";
import { useProjectsScanTelemetry } from "./useProjectsScanTelemetry";
import { useOnboardingProjectImport } from "./useOnboardingProjectImport";
import { useRefetchOnUpdateNeeded } from "./useRefetchOnUpdateNeeded";
import { useSendAfterFirstOutput } from "./useSendAfterFirstOutput";
import {
  useAgentSignIns,
  type AgentSignInTerminals,
  type RefetchProviderStates,
} from "./useAgentSignIns";

const SIGN_IN_TERMINAL_COLS = 200;
const SIGN_IN_TERMINAL_ROWS = 14;
const SIGN_IN_OUTPUT_POLL_INTERVAL_MS = 1_000;
const SIGN_IN_OUTPUT_TAIL_BYTES = 64 * 1024;
const SIGN_IN_TERMINAL_FALLBACK_DELAY_MS = 3_000;
const CONNECT_INPUT_SETTLE_MS = 500;
const INSTALL_SETTLE_TIMEOUT_MS = 20_000;
const INSTALL_SETTLE_POLL_MS = 2_000;
const INSTALL_FAILED_MESSAGE =
  "Couldn't install. Check your connection and retry.";
const AGENT_STATES_LOAD_TIMEOUT_MS = 10_000;
const ONBOARDING_PHONE_QUERY = "(max-width: 640px) and (pointer: coarse)";
const ONBOARDING_COMPACT_QUERY = "(max-width: 640px)";

function useLoadTimedOut(loading: boolean, timeoutMs: number) {
  const [attempt, setAttempt] = useState(0);
  const [timedOutAttempt, setTimedOutAttempt] = useState<number | null>(null);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(
      () => setTimedOutAttempt(attempt),
      timeoutMs,
    );
    return () => window.clearTimeout(timer);
  }, [attempt, loading, timeoutMs]);
  const restart = useCallback(() => setAttempt((current) => current + 1), []);
  return { timedOut: loading && timedOutAttempt === attempt, restart };
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
  parsed,
  connectFlow,
  agentName,
  session,
  onExit,
  onFail,
  onViewChange,
}: {
  parsed: boolean;
  connectFlow: TerminalConnectFlow | null;
  onViewChange: (view: AgentSignInView) => void;
  agentName: string;
  session: TerminalSession;
  onExit: (exitCode: number | null) => void;
  onFail: () => void;
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
  const outputText = useMemo(
    () => (output === undefined ? null : decodeTerminalChunks(output.chunks)),
    [output],
  );
  const connectFailed =
    connectFlow !== null &&
    outputText !== null &&
    connectFlowFailed(connectFlow, outputText);
  useEffect(() => {
    if (connectFailed) onFail();
  }, [connectFailed, onFail]);
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
  const view = useMemo(
    () =>
      agentSignInView({
        parsed,
        connect: connectFlow !== null,
        outputText,
        fallbackDue,
        terminalChoice,
      }),
    [connectFlow, fallbackDue, outputText, parsed, terminalChoice],
  );
  const { terminalVisible } = view;
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

interface StepChrome {
  compact: boolean;
  reserveMacosTrafficLights: boolean;
  skippedSteps: ReadonlySet<OnboardingStepId>;
  onSelectStep: (step: OnboardingStepId) => void;
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
  entry,
  hostId,
  hostConnected,
  noHost,
  hostName,
  loadRecords,
  onContinue,
}: {
  chrome: StepChrome;
  entry: OnboardingEntry;
  hostId: string | null;
  hostConnected: boolean;
  noHost: boolean;
  hostName: string | null;
  loadRecords: StepLoadRecords;
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
  const queryClient = useQueryClient();
  const installRunner = useProviderCliInstallRunner();
  const { isLocalDaemonHost } = useHostDaemon();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const { refetch: refetchStates } = statesQuery;
  const { mutate: closeTerminalMutate } = closeTerminal;
  const { mutateAsync: createTerminalAsync } = createTerminal;
  const states = statesQuery.data?.providers;
  const statesLoading =
    hostId !== null && states === undefined && !statesQuery.isError;
  const statesLoad = useLoadTimedOut(
    statesLoading,
    AGENT_STATES_LOAD_TIMEOUT_MS,
  );
  const catalogQuery = useSystemProviderCatalog();
  const checkedProviderIds = useMemo(
    () =>
      (catalogQuery.data ?? [])
        .filter(
          (entry) => entry.enabled && entry.pluginEnabled && entry.available,
        )
        .map((entry) => entry.id),
    [catalogQuery.data],
  );
  const checks = useHostProviderStatesAsTheyLoad({
    hostId,
    providerIds: checkedProviderIds,
    enabled: hostId !== null && states === undefined,
  });
  const providerNames = useMemo(
    () =>
      new Map(
        (catalogQuery.data ?? []).map((entry) => [entry.id, entry.displayName]),
      ),
    [catalogQuery.data],
  );
  const checksSettled = checks.every((check) => check.kind !== "pending");
  const statesLoadTimedOut =
    statesLoad.timedOut &&
    checks.every((check) => check.kind === "absent" || check.kind === "failed");
  const rows = resolveAgentRows({
    states,
    statesSettledAt: statesQuery.dataUpdatedAt,
    checks,
    names: providerNames,
  });
  const listFailed =
    hostId !== null &&
    (rows === undefined
      ? states === undefined &&
        checksSettled &&
        (statesQuery.isError || statesLoad.timedOut)
      : rows.length > 0 && rows.every((row) => row.kind === "failed"));
  const loadFailed = listFailed
    ? {
        message: agentListFailedMessage({
          failure: agentListFailure({
            hostConnected,
            errors: [
              statesQuery.error,
              ...checks.flatMap((check) =>
                check.kind === "failed" ? [check.error] : [],
              ),
            ],
          }),
          machineName: hostName,
        }),
        retrying:
          rows === undefined
            ? !checksSettled
            : rows.some((row) => row.kind === "failed" && row.retrying),
      }
    : null;
  const shownStates = rows?.flatMap((row) =>
    row.kind === "agent" ? [row.state] : [],
  );
  const recheck = (providerIds: readonly string[]) => {
    if (hostId === null || providerIds.length === 0) return;
    void recheckHostProviderStates({ queryClient, hostId, providerIds });
  };
  useLoadTelemetry({
    entry,
    step: "agent",
    records: loadRecords,
    noHost,
    query: statesQuery,
    loaded: states !== undefined,
    timedOut: statesLoadTimedOut,
  });
  const refetchProviderStates = useCallback<RefetchProviderStates>(
    (options) => {
      void refetchStates(options);
    },
    [refetchStates],
  );
  const { refetch: refetchCliStatus } = cliStatusQuery;
  const refetchCliStatusOnce = useCallback(() => {
    void refetchCliStatus({ cancelRefetch: false });
  }, [refetchCliStatus]);
  useRefetchOnUpdateNeeded({
    states,
    statesUpdatedAt: statesQuery.dataUpdatedAt,
    cliStatus: cliStatusQuery.data,
    refetch: refetchCliStatusOnce,
  });
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
  const statesRefresh = useRefetchAfterFirstLoad({
    loaded: states !== undefined || statesQuery.isError,
    settledAt: Math.max(statesQuery.dataUpdatedAt, statesQuery.errorUpdatedAt),
    refetch: refetchProviderStates,
  });
  const signIns = useAgentSignIns({
    entry,
    hostId,
    states: shownStates,
    statesSettledAt: statesRefresh.settledAt,
    isLocalHost: (targetHostId) =>
      signInBrowserIsOnMachine({
        agentOnLocalDaemonHost: isLocalDaemonHost(targetHostId),
        hostname: window.location.hostname,
        isDesktop: getBbDesktopInfo() !== null,
      }),
    terminals: signInTerminals,
    refetchStates: statesRefresh.refetch,
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
    if (previous === null || previous === runningJobKey) return;
    if (installFailures.has(previous)) return;
    setSettlingJobKeys((keys) =>
      new Map(keys).set(previous, Date.now() + INSTALL_SETTLE_TIMEOUT_MS),
    );
  }, [installFailures, runningJobKey]);
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

  const [awaitingInstallInfoIds, setAwaitingInstallInfoIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const startInstall = async (providerId: string) => {
    if (hostId === null) return;
    const installInfo =
      cliStatusQuery.data ??
      (await loadInstallInfo(
        queryClient,
        hostId,
        providerId,
        setAwaitingInstallInfoIds,
      ));
    const status = installInfo?.[providerId];
    if (status === undefined) return;
    const issue = buildProviderCliIssue({ provider: providerId, status });
    if (issue === null || !hasProviderCliAction(issue)) return;
    installRunner.startInstall({ hostId, issue, onboardingEntry: entry });
  };

  const providerIcon = (providerId: string) =>
    providersQuery.data?.find((provider) => provider.id === providerId) ??
    catalogQuery.data?.find((entry) => entry.id === providerId) ?? {
      id: providerId,
      logoUrl: null,
    };
  const agents: (OnboardingAgent | AgentLoadingRow)[] | null =
    hostId === null || rows === undefined || listFailed
      ? null
      : rows.map((row) => {
          if (row.kind === "loading") return { loadingKey: row.key };
          if (row.kind === "failed") {
            return {
              id: row.providerId,
              name: row.name,
              provider: providerIcon(row.providerId),
              state: {
                status: "checkFailed",
                message: agentCheckFailedMessage(row.failure),
                detail: row.detail,
                retrying: row.retrying,
              },
            };
          }
          const health = row.state;
          const jobKey = providerCliJobKey(hostId, health.providerId);
          const signIn = signIns.signIns.get(health.providerId) ?? null;
          const starting = signIns.startingProviderIds.has(health.providerId);
          const signingIn = signIn !== null || starting;
          const installFailure = installRunner.failuresByJobKey.get(jobKey);
          const connectFlow = terminalConnectFlow(health.providerId);
          const parsed = health.internal_DO_NOT_USE_guidedSignIn;
          const view = signIns.views.get(health.providerId) ?? null;
          const instructionReady = view !== null && view.started;
          return {
            id: health.providerId,
            name: health.displayName,
            provider: providerIcon(health.providerId),
            setup: agentRowSetup({
              connect: connectFlow !== null,
              awaitingSession: starting && signIn === null,
            }),
            installQueued: installRunner.queuedJobKeys.has(jobKey),
            ...(installFailure !== undefined
              ? { installLog: installFailure.logDialogState.log }
              : {}),
            subline:
              connectFlow === null &&
              signIn !== null &&
              view !== null &&
              instructionReady ? (
                <AgentSignInInstruction
                  agentName={health.displayName}
                  view={view}
                  onOpenUrl={openUrlInExternalBrowser}
                />
              ) : undefined,
            state: resolveAgentSetupState({
              health: setupGuidePlanHealth(health),
              cliStatus: cliStatusQuery.data?.[health.providerId],
              installing:
                awaitingInstallInfoIds.has(health.providerId) ||
                installRunner.runningJobKey === jobKey ||
                installRunner.queuedJobKeys.has(jobKey) ||
                (settlingJobKeys.has(jobKey) &&
                  (health.status === "not_installed" ||
                    health.status === "unsupported_version")),
              installFailure:
                installFailure === undefined ? null : INSTALL_FAILED_MESSAGE,
              signingIn,
              signInFailed: signIns.failedProviderIds.has(health.providerId),
              installInfoPending: cliStatusQuery.isPending,
            }),
            expanded:
              signIn === null ? undefined : (
                <AgentSignInContainer
                  key={signIn.session.id}
                  parsed={parsed}
                  connectFlow={connectFlow}
                  agentName={health.displayName}
                  session={signIn.session}
                  onExit={(exitCode) =>
                    signIns.handleExit(health.providerId, exitCode)
                  }
                  onFail={() => signIns.fail(health.providerId)}
                  onViewChange={(nextView) =>
                    signIns.setView(health.providerId, nextView)
                  }
                />
              ),
          };
        });

  return (
    <OnboardingLayout
      {...chrome}
      step="agent"
      {...STEP_COPY.agent}
      primaryDisabled={statesLoading && !statesLoad.timedOut}
      onPrimary={onContinue}
    >
      <AgentStep
        machineName={hostName}
        agents={agents}
        loadFailed={loadFailed}
        onSignIn={(providerId) => void startSignIn(providerId)}
        onInstall={(providerId) => void startInstall(providerId)}
        onCancelSignIn={(providerId) => signIns.end(providerId)}
        onRetryCheck={(providerId) => recheck([providerId])}
        onRecheck={() => {
          statesLoad.restart();
          if (checks.length === 0) {
            void restartSystemProviderStatesLoad({ queryClient, hostId });
            return;
          }
          recheck(failedAgentProviderIds(rows, checks));
        }}
      />
    </OnboardingLayout>
  );
}

function ProjectsStepContainer({
  chrome,
  entry,
  hostId,
  projectIdsAtOpen,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
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
  const copy = STEP_COPY.projects;
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
      onBack={onBack}
    >
      <ProjectsStep
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

async function loadInstallInfo(
  queryClient: QueryClient,
  targetHostId: string,
  providerId: string,
  setAwaitingInstallInfoIds: Dispatch<SetStateAction<ReadonlySet<string>>>,
): Promise<ProviderCliStatusResponse | undefined> {
  setAwaitingInstallInfoIds((ids) => new Set(ids).add(providerId));
  try {
    return await queryClient.fetchQuery(
      hostProviderCliStatusQueryOptions({ hostId: targetHostId }),
    );
  } catch {
    return undefined;
  } finally {
    setAwaitingInstallInfoIds((ids) => {
      const next = new Set(ids);
      next.delete(providerId);
      return next;
    });
  }
}

function PluginCardContainer({
  onboardingEntry,
  trackInstall,
  entry,
  enabled,
  switches,
  onSelected,
  onDeselected,
}: {
  onboardingEntry: OnboardingEntry;
  trackInstall: TrackPluginInstall;
  entry: PluginCatalogSearchEntry;
  enabled: boolean;
  switches: OnboardingPluginSwitches;
  onSelected: () => void;
  onDeselected: () => void;
}) {
  const changePlugin = useOnboardingPluginChange({
    onboardingEntry,
    plugin: entry,
    trackInstall,
  });

  const toggle = (next: boolean) => {
    if (next) onSelected();
    else onDeselected();
    switches.set({
      pluginId: entry.pluginId,
      enabled: next,
      serverEnabled: enabled,
      apply: changePlugin,
      onFailed: (error) =>
        appToast.error(
          error instanceof Error
            ? error.message
            : `Failed to update ${entry.displayName}.`,
        ),
    });
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
      enabled={switches.shown(entry.pluginId, enabled)}
      unavailableReason={
        entry.installed || entry.compatible
          ? null
          : (entry.incompatibleReason ?? "Not available on this server.")
      }
      onToggle={toggle}
    />
  );
}

function PluginsStepContainer({
  chrome,
  entry: onboardingEntry,
  trackInstall,
  switches,
  loadRecords,
  onBack,
  onContinue,
  onSkip,
}: {
  chrome: StepChrome;
  entry: OnboardingEntry;
  trackInstall: TrackPluginInstall;
  switches: OnboardingPluginSwitches;
  loadRecords: StepLoadRecords;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  useLoadTelemetry({
    entry: onboardingEntry,
    step: "plugins",
    records: loadRecords,
    noHost: false,
    query: catalogQuery,
    loaded: catalogQuery.data !== undefined,
    timedOut: false,
  });
  const listQuery = usePluginList({ enabled: true });
  const { refetch: refetchCatalog } = catalogQuery;

  const installedPlugins = listQuery.data?.plugins;
  const installedCount = installedPlugins?.length ?? 0;
  useEffect(() => {
    void refetchCatalog();
  }, [installedCount, refetchCatalog]);

  const entries = useMemo(() => {
    const all = catalogQuery.data?.entries;
    if (all === undefined) return null;
    return ONBOARDING_PLUGIN_ENTRY_IDS.flatMap((entryId) => {
      const entry = all.find(
        (candidate) =>
          candidate.marketplace === ONBOARDING_PLUGIN_MARKETPLACE &&
          candidate.entryId === entryId,
      );
      return entry === undefined ? [] : [entry];
    });
  }, [catalogQuery.data?.entries]);
  const isEnabled = (entry: PluginCatalogSearchEntry) =>
    entry.installed &&
    (installedPlugins?.find((plugin) => plugin.id === entry.pluginId)
      ?.enabled ??
      false);
  const isShownEnabled = (entry: PluginCatalogSearchEntry) =>
    switches.shown(entry.pluginId, isEnabled(entry));

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
      width="wide"
      {...STEP_COPY.plugins}
      onPrimary={() => {
        if (!(entries ?? []).some(isShownEnabled)) onSkip();
        else onContinue();
      }}
      onBack={onBack}
    >
      <OnboardingPluginGrid compact={chrome.compact}>
        {entries === null ? (
          <OnboardingPluginGridSkeleton
            count={ONBOARDING_PLUGIN_ENTRY_IDS.length}
          />
        ) : (
          entries.map((entry) => (
            <PluginCardContainer
              key={entry.entryId}
              onboardingEntry={onboardingEntry}
              trackInstall={trackInstall}
              entry={entry}
              enabled={isEnabled(entry)}
              switches={switches}
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
  entry,
  hostId,
  hostName,
  closing,
  onBack,
  onFinish,
  onLeave,
}: {
  chrome: StepChrome;
  entry: OnboardingEntry;
  hostId: string | null;
  hostName: string | null;
  closing: boolean;
  onBack: () => void;
  onFinish: () => void;
  onLeave: () => void;
}) {
  const configQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const onPhone = useMediaQuery(ONBOARDING_PHONE_QUERY);
  const location = useLocation();
  const [openPathname, setOpenPathname] = useState(location.pathname);
  const [wasClosing, setWasClosing] = useState(closing);
  if (wasClosing !== closing) {
    setWasClosing(closing);
    if (!closing) setOpenPathname(location.pathname);
  }
  const navigatedAway =
    !closing && !wasClosing && location.pathname !== openPathname;
  useEffect(() => {
    if (navigatedAway) onLeave();
  }, [navigatedAway, onLeave]);
  const connect = connectAccessUrl(configQuery.data?.serverAccess);
  const connectContributesSection = usePluginSlotKind(
    "setupGuideSections",
  ).some((section) => section.pluginId === CONNECT_PLUGIN_ID);
  const showMachines = devicesShowMachines(connect);
  const connectedMachineCount = hostsQuery.data?.filter(
    (host) => host.id !== hostId && host.status === "connected",
  ).length;
  const { startRemoteAccessSetup, failRemoteAccessSetup, failAddMachine } =
    useDeviceSetupTracking({
      entry,
      connectStatus: connect.status,
      addMachineCommandShown: addMachineOpen && showMachines,
      connectedMachineCount,
    });
  const addMachine = () => setAddMachineOpen(true);
  const closeAddMachine = () => {
    void hostsQuery.refetch();
    setAddMachineOpen(false);
  };
  return (
    <OnboardingLayout
      {...chrome}
      step="devices"
      width="wide"
      {...STEP_COPY.devices}
      onPrimary={onFinish}
      onBack={onBack}
    >
      <DevicesStep
        hostName={hostName}
        showMachines={showMachines}
        connectSection={
          connectContributesSection ? (
            <PluginSetupGuideSections
              pluginId={CONNECT_PLUGIN_ID}
              onPhone={onPhone}
              onSetupStarted={startRemoteAccessSetup}
              onSetupFailed={failRemoteAccessSetup}
            />
          ) : null
        }
        addMachinePanel={
          addMachineOpen && showMachines ? (
            <AddMachineInline onEnrollmentFailed={failAddMachine} />
          ) : null
        }
        onAddMachine={addMachine}
        onCloseAddMachine={closeAddMachine}
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
  closing,
  onClose,
}: {
  initialStep: OnboardingStepId;
  entry: OnboardingEntry;
  closing: boolean;
  onClose: (lastStep: OnboardingStepId) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const onPhone = useMediaQuery(ONBOARDING_PHONE_QUERY);
  useEffect(() => {
    setToasterCompactPlacement(onPhone);
    return () => setToasterCompactPlacement(null);
  }, [onPhone]);
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
  const trackPluginInstall = useOnboardingPluginInstallOutcomes(entry);
  const pluginSwitches = useOnboardingPluginSwitches();
  const [loadRecords] = useState<StepLoadRecords>(() => new Map());
  const finishedRef = useRef(false);
  useOnboardingLeftTelemetry({ entry, step, finishedRef });
  useOnboardingErrorStep(step);
  useEffect(() => {
    if (!closing) finishedRef.current = false;
  }, [closing]);
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
    skippedSteps: skippedStepIds(stepOutcomes),
    onSelectStep: setStep,
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
          entry={entry}
          hostId={hostId}
          hostConnected={primaryHost?.status === "connected"}
          noHost={noHost}
          hostName={primaryHost?.name ?? null}
          loadRecords={loadRecords}
          onContinue={advance(
            hasReadyAgent(agentStates) ? "completed" : "skipped",
          )}
        />
      );
    case "projects":
      return (
        <ProjectsStepContainer
          chrome={chrome}
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
          entry={entry}
          trackInstall={trackPluginInstall}
          switches={pluginSwitches}
          loadRecords={loadRecords}
          onBack={goTo(-1)}
          onContinue={advance("completed")}
          onSkip={advance("skipped")}
        />
      );
    case "devices":
      return (
        <DevicesStepContainer
          chrome={chrome}
          entry={entry}
          hostId={hostId}
          hostName={primaryHost?.name ?? null}
          closing={closing}
          onBack={goTo(-1)}
          onFinish={() => close("completed")}
          onLeave={() => close("skipped")}
        />
      );
  }
}
