import { useCallback, useContext, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  PluginMessageActionRegistration,
  ThreadChatMessageAction,
  ThreadChatProps,
} from "@get-bb/plugin-sdk";
import { CORE_PLUGIN_ID } from "@bb/domain";
import { collectThreadChatMessageActions } from "@/lib/plugin-message-actions";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import { isThreadForkable } from "@bb/client-core";
import { type ThreadTimelineForkMessageHandler } from "@/components/thread/timeline";
import {
  ThreadTimelineNavigationProvider,
  useThreadTimelineNavigation,
} from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useThreadFileLinkOpener } from "@/hooks/useLocalFileLinkOpener";
import { PluginContext } from "@/components/plugin/plugin-context";
import { PluginComposerHostScopeProvider } from "@/components/plugin/plugin-composer-host";
import { ThreadProviderContext } from "@/components/thread/thread-provider-context";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useEnvironmentCheckoutDisplay } from "@/hooks/queries/git-plugin-queries";
import { useSystemProviderInfo } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadTimelineSubscription } from "@/hooks/queries/thread-panel-queries";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useForkThreadFromMessage } from "@/hooks/useForkThreadFromMessage";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentSummaryChrome,
  isHostAmbiguous,
} from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { BbHttpError } from "@/lib/sdk";
import { ThreadChatLoadingBody } from "@/components/thread/timeline/ThreadChatLoading";
import {
  getProjectComposeRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  resolveThreadEnvironmentAccess,
  useThreadTimelineTitleActions,
} from "@/views/thread-detail/thread-screen-hosts";
import { useThreadUnreadDividerState } from "@/views/thread-detail/useThreadUnreadDividerState";
import { useCreateThreadInEnvironment } from "@/hooks/useCreateThreadInEnvironment";
import {
  ThreadScreen,
  type ThreadScreenPresentation,
} from "@/views/thread-detail/ThreadScreen";
import { openThread } from "@/lib/split-layout/openThread";

export function PluginThreadChat({
  threadId,
  variant = "full",
  layout = "contained",
  focusRequest,
  permissionPolicy = "inherit",
  className,
  leadingContent,
  messageActions,
  experimental_messageActions,
}: ThreadChatProps) {
  const containerClassName = cn(
    layout === "contained" ? "flex h-full min-h-0 flex-col" : "flex flex-col",
    className,
  );
  return (
    <div className={containerClassName}>
      <PluginThreadChatBody
        threadId={threadId}
        variant={variant}
        layout={layout}
        focusRequest={focusRequest}
        permissionPolicy={permissionPolicy}
        leadingContent={leadingContent}
        messageActions={messageActions}
        experimentalMessageActions={experimental_messageActions}
      />
    </div>
  );
}

interface PluginThreadChatBodyProps {
  threadId: string;
  variant: "full" | "compact" | "timeline";
  layout: "contained" | "document";
  focusRequest: number | undefined;
  permissionPolicy: "inherit" | "editable";
  leadingContent: ReactNode;
  messageActions: readonly ThreadChatMessageAction[] | undefined;
  experimentalMessageActions:
    | readonly PluginMessageActionRegistration[]
    | undefined;
}

function PluginThreadChatBody({
  threadId,
  variant,
  layout,
  focusRequest,
  permissionPolicy,
  leadingContent,
  messageActions,
  experimentalMessageActions,
}: PluginThreadChatBodyProps) {
  const threadQuery = useThread(threadId, { enabled: threadId.length > 0 });
  const thread = threadQuery.data;
  const hasComposer = variant !== "timeline";
  useThreadTimelineSubscription(threadId, { enabled: threadId.length > 0 });
  const markThreadRead = useMarkThreadRead();
  const unreadDividerState = useThreadUnreadDividerState({
    hasFreshThread:
      thread !== undefined &&
      !threadQuery.isPlaceholderData &&
      !threadQuery.isFetching,
    routeThreadId: threadId,
    thread,
  });
  useThreadReadTracking({
    markThreadRead,
    thread: hasComposer && unreadDividerState.ready ? thread : undefined,
  });
  const threadProviderInfo = useSystemProviderInfo(
    thread?.environmentId
      ? {
          enabled: true,
          environmentId: thread.environmentId,
          providerId: thread.providerId,
        }
      : {
          enabled: thread !== undefined,
          providerId: thread?.providerId,
        },
  );
  const threadProviderPluginId = threadProviderInfo?.pluginId ?? null;
  const threadProviderContextValue = useMemo(
    () => ({
      providerId: thread?.providerId ?? null,
      pluginId: threadProviderPluginId,
    }),
    [thread?.providerId, threadProviderPluginId],
  );
  const navigate = useNavigate();
  const paneNavigateInPane = useOptionalPaneContext()?.navigateInPane;
  const navigateToThread = useCallback(
    (target: ThreadRoutePathArgs) => {
      if (paneNavigateInPane) {
        paneNavigateInPane(target);
        return;
      }
      openThread({ navigate, ...target });
    },
    [navigate, paneNavigateInPane],
  );
  const forkThreadFromMessage = useForkThreadFromMessage({
    navigateInPane: navigateToThread,
    sourceThread: thread ?? null,
  });
  const handleForkMessage = useCallback<ThreadTimelineForkMessageHandler>(
    (target) => {
      void forkThreadFromMessage(target);
    },
    [forkThreadFromMessage],
  );
  const isForkAvailable =
    hasComposer &&
    isThreadForkable(
      thread ?? null,
      threadProviderInfo?.capabilities.supportsFork ?? false,
    );
  const { isLocalDaemonHost } = useHostDaemon();
  const environmentQuery = useEnvironment(thread?.environmentId ?? null);
  const environment = environmentQuery.data ?? null;
  const environmentAccess = resolveThreadEnvironmentAccess({
    thread: thread ?? null,
    environment,
    environmentLoadFailed: environmentQuery.isError,
  });
  const createThreadInEnvironment = useCreateThreadInEnvironment({
    projectId: thread?.projectId ?? "",
    environmentId: thread?.environmentId ?? "",
    sectionId: thread?.sectionId ?? null,
    pinned: thread?.pinnedAt != null,
  });
  const hostsQuery = useHosts({ enabled: environment !== null });
  const environmentHost = environment
    ? (hostsQuery.data?.find((host) => host.id === environment.hostId) ?? null)
    : null;
  const hasMultipleMachines = (hostsQuery.data?.length ?? 0) > 1;
  const { providers: environmentProviders } = useSystemEnvironmentProviders();
  const { providers: machineProviders } = useSystemMachineProviders();
  const timelineNavigation = useThreadTimelineNavigation();
  const canUseHostFileNavigation =
    thread !== undefined &&
    thread.environmentId === timelineNavigation?.environmentId;
  const navigation = useAppNavigationHost();
  const onOpenLocalFileLink = useThreadFileLinkOpener({
    environment,
    openFilePreview: navigation.openFilePreview,
    threadId: thread?.id,
  }).openLink;
  const handleTimelineTitleAction = useThreadTimelineTitleActions({
    threadId,
    projectId: thread?.projectId ?? "",
    openThread: navigateToThread,
    environmentId: thread?.environmentId ?? null,
    panel: navigation.panel,
    openFilePreview: navigation.openFilePreview,
    openLocalFileLink: onOpenLocalFileLink,
  });
  const resolveHostMentionLink = canUseHostFileNavigation
    ? timelineNavigation.resolveMentionLink
    : undefined;
  const workspaceRootPath =
    environment?.path ??
    (canUseHostFileNavigation
      ? timelineNavigation.workspaceRootPath
      : undefined);
  const pluginId = useContext(PluginContext);
  const instanceMessageActions = useMemo(
    () =>
      collectThreadChatMessageActions({
        pluginId: pluginId ?? CORE_PLUGIN_ID,
        legacyActions: messageActions,
        registrations: experimentalMessageActions,
      }),
    [experimentalMessageActions, messageActions, pluginId],
  );

  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? thread?.projectId;
        if (targetProjectId === undefined) return null;
        return () =>
          openThread({
            navigate,
            projectId: targetProjectId,
            threadId: resource.threadId,
          });
      }
      if (resource.kind === "project") {
        return () =>
          void navigate(getProjectComposeRoutePath(resource.projectId));
      }
      if (
        resource.kind === "path" &&
        resource.entryKind === "file" &&
        resource.source === "workspace"
      ) {
        return resolveHostMentionLink?.(resource) ?? null;
      }
      return null;
    },
    [navigate, resolveHostMentionLink, thread?.projectId],
  );

  const environmentChrome = useMemo(() => {
    if (environment === null) {
      return undefined;
    }
    const host: EnvironmentDisplayHostContext = {
      locality: isLocalDaemonHost(environment.hostId) ? "local" : "remote",
      identity: null,
    };
    const providerLookup = findEnvironmentDisplayProvider(
      environmentProviders,
      environment.environmentProviderId,
    );
    const display = formatEnvironmentDisplay({
      environment,
      host,
      providerLookup,
    });
    return getEnvironmentSummaryChrome({
      display,
      providerLookup,
      hasMultipleMachines,
      host: environmentHost,
      machineProviders,
    });
  }, [
    environment,
    environmentHost,
    environmentProviders,
    hasMultipleMachines,
    isLocalDaemonHost,
    machineProviders,
  ]);
  const environmentCheckout = useEnvironmentCheckoutDisplay(
    hasComposer && environment?.isGitRepo === true ? environment.id : null,
  );

  const isThreadMissing =
    threadQuery.error instanceof BbHttpError &&
    threadQuery.error.status === 404;
  if (isThreadMissing) {
    return (
      <EmptyStatePanel className="m-2 rounded-lg">
        This thread is no longer available.
      </EmptyStatePanel>
    );
  }
  if (thread === undefined) {
    return (
      <ThreadChatLoadingBody
        leadingContent={leadingContent}
        variant={variant}
      />
    );
  }

  const presentation: ThreadScreenPresentation =
    variant === "timeline"
      ? { kind: "transcript", layout }
      : {
          kind: "panel",
          layout,
          measure: variant === "full" ? "page" : "panel",
          tone: variant === "compact" ? "sidebar" : "background",
        };
  return (
    <ThreadProviderContext.Provider value={threadProviderContextValue}>
      <PluginComposerHostScopeProvider>
        <ThreadTimelineNavigationProvider
          environmentId={thread.environmentId}
          hostId={environment?.hostId ?? null}
          onOpenLocalFileLink={onOpenLocalFileLink}
          resolveMentionLink={resolveMentionLink}
          threadId={thread.id}
          workspaceRootPath={workspaceRootPath}
        >
          <ThreadScreen
            composer={
              hasComposer
                ? {
                    environmentCheckout,
                    environmentChrome,
                    focusRequest: focusRequest ?? null,
                    contextEnvironmentId: null,
                    onCreateNewThreadInEnvironment:
                      environmentAccess.reusesEnvironment
                        ? createThreadInEnvironment
                        : null,
                    onOpenThreadInfo: null,
                    permissionPolicy:
                      permissionPolicy === "editable" ? "editable" : "snapshot",
                  }
                : null
            }
            environment={environment}
            presentation={presentation}
            projectId={thread.projectId}
            resolveMentionLink={resolveMentionLink}
            thread={thread}
            timelineEnabled
            timelineHost={{
              instanceMessageActions,
              environmentHostName:
                environmentHost !== null &&
                isHostAmbiguous(hasMultipleMachines, environmentHost.type)
                  ? environmentHost.name
                  : null,
              leadingContent: leadingContent ?? null,
              messageActionSurface: "embedded-chat",
              onForkMessage: isForkAvailable ? handleForkMessage : null,
              onTitleAction: handleTimelineTitleAction,
              unreadDividerAutoScroll: unreadDividerState.autoScroll,
              unreadDividerPlacement: unreadDividerState.placement,
            }}
          />
        </ThreadTimelineNavigationProvider>
      </PluginComposerHostScopeProvider>
    </ThreadProviderContext.Provider>
  );
}
