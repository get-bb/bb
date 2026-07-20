import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadChatProps } from "@bb/plugin-sdk";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { ThreadTimelinePanelContent } from "@/components/thread/timeline";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { BbHttpError } from "@/lib/sdk";
import {
  getProjectComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";

/**
 * Host implementation of the SDK's `ThreadChat` (plugin design: the one
 * deliberate exception to the §5.5 no-host-components rule). A thin adapter
 * over `EmbeddedThreadChat`: the public contract is just `threadId` +
 * presentation, so everything the engine needs (project, provider,
 * environment, drafts scope) is derived from the thread itself. Renders
 * wherever plugin slots mount — the whole plugin UI tree lives inside the
 * host app's providers (react-query, router, jotai), so no extra context
 * wiring is required here.
 */
export function PluginThreadChat({
  threadId,
  variant = "full",
  layout = "contained",
  focusRequest,
  className,
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
      />
    </div>
  );
}

interface PluginThreadChatBodyProps {
  threadId: string;
  variant: "full" | "compact" | "timeline";
  layout: "contained" | "document";
  focusRequest: number | undefined;
}

function PluginThreadChatBody({
  threadId,
  variant,
  layout,
  focusRequest,
}: PluginThreadChatBodyProps) {
  const threadQuery = useThread(threadId, { enabled: threadId.length > 0 });
  const thread = threadQuery.data;
  const navigate = useNavigate();
  const { isLocalDaemonHost } = useHostDaemon();
  const environmentQuery = useEnvironment(thread?.environmentId ?? null);
  const environment = environmentQuery.data ?? null;

  // Threads and projects stay navigable from a plugin surface; file mentions
  // have no file viewer here, so their pills render as plain text.
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? thread?.projectId;
        if (targetProjectId === undefined) return null;
        return () =>
          navigate(
            getThreadRoutePath({
              projectId: targetProjectId,
              threadId: resource.threadId,
            }),
          );
      }
      if (resource.kind === "project") {
        return () => navigate(getProjectComposeRoutePath(resource.projectId));
      }
      return null;
    },
    [navigate, thread?.projectId],
  );

  const environmentSummary = useMemo(() => {
    if (environment === null) {
      return (
        <ThreadEnvironmentSummary
          environmentLabel="Working locally"
          environmentCompactLabel="Local"
        />
      );
    }
    const host: EnvironmentDisplayHostContext = {
      locality: isLocalDaemonHost(environment.hostId) ? "local" : "remote",
      identity: null,
    };
    const display = formatEnvironmentDisplay({ environment, host });
    return (
      <ThreadEnvironmentSummary
        environmentLabel={display.modeLabel}
        environmentCompactLabel={display.compactModeLabel}
        environmentIcon={getEnvironmentWorkspaceLabelIconName(
          display.workspaceDisplayKind,
        )}
        environmentCheckout={
          environment.branchName
            ? formatWorkspaceCheckoutDisplay({
                checkout: {
                  kind: "branch",
                  branchName: environment.branchName,
                  headSha: null,
                },
              })
            : undefined
        }
      />
    );
  }, [environment, isLocalDaemonHost]);

  const isThreadMissing =
    threadQuery.error instanceof BbHttpError && threadQuery.error.status === 404;
  if (isThreadMissing) {
    return (
      <EmptyStatePanel className="m-2 rounded-lg">
        This thread is no longer available.
      </EmptyStatePanel>
    );
  }
  if (thread === undefined) {
    return (
      <div className="space-y-2 px-4 pt-4">
        <Skeleton className="h-4 w-3/4 rounded-sm" />
        <Skeleton className="h-4 w-2/3 rounded-sm" />
        <Skeleton className="h-4 w-1/2 rounded-sm" />
      </div>
    );
  }

  if (variant === "timeline") {
    const transcript = (
      <ThreadTimelinePanelContent
        projectId={thread.projectId}
        resolveMentionLink={resolveMentionLink}
        surfaceKey={`plugin-thread-chat:${threadId}`}
        threadId={threadId}
        workspaceRootPath={environment?.path ?? undefined}
      />
    );
    return layout === "contained" ? (
      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-2 pb-3 pt-3">
        {transcript}
      </div>
    ) : (
      <div className="bg-background px-2 pb-3 pt-3">{transcript}</div>
    );
  }

  return (
    <EmbeddedThreadChat
      variant="compact"
      layout={layout}
      measure={variant === "full" ? "page" : "panel"}
      threadId={threadId}
      projectId={thread.projectId}
      providerId={thread.providerId}
      promptContextEnvironmentId={thread.environmentId}
      resolveMentionLink={resolveMentionLink}
      composer={{
        draftScope: {
          kind: "thread",
          projectId: thread.projectId,
          threadId,
        },
        executionDefaultsThreadId: threadId,
        executionResetKey: threadId,
        executionEnvironmentId: thread.environmentId ?? undefined,
        // The thread's own resolved defaults, never widened by a plugin
        // surface: sends run with exactly what the thread would use.
        permissionPolicy: "snapshot",
        environmentSummary,
        contextWindowUsage: null,
        isPrimaryComposer: false,
        pluginComposerBottomScope: { kind: "thread", threadId },
        composerIdentity: `plugin-thread-chat:${threadId}`,
        focusRequestKey: focusRequest,
      }}
    />
  );
}
