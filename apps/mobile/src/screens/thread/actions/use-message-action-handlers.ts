import { isThreadForkable } from "@bb/client-core";
import type { ThreadResponse } from "@bb/server-contract";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { buildForkComposeParams, useComposePreferences } from "@/data/compose";
import { useSystemProviders } from "@/data/system";
import { getThreadDisplayTitle } from "@/data/threads";
import { SIDE_CHAT_PLUGIN_ID } from "@/data/thread-detail";
import { toast } from "@/ui";
import { newThreadHref } from "../../shell/hrefs";
import type { TimelineMessageActionHandlers } from "./message-actions-model";
import { useSendMessageToMainThread } from "./use-send-to-main-thread";

interface UseMessageActionHandlersArgs {
  /** The open thread; undefined until it loads (every action stays hidden). */
  thread: ThreadResponse | undefined;
  /**
   * Composer-owned handlers (quote into the draft, edit mode). Absent until
   * the shared composer mounts, which hides those actions.
   */
  quoteIntoComposer?: TimelineMessageActionHandlers["quoteIntoComposer"];
  editMessage?: TimelineMessageActionHandlers["editMessage"];
}

/**
 * The screen-level message action handlers the timeline host receives:
 * fork (when the provider can fork and the thread has an environment),
 * send-to-main (side chats only), plus the composer handlers passed through.
 *
 * Forking mirrors the web `useForkThreadFromMessage`: the source thread's
 * resolved execution options become the compose picks (same preference
 * store the compose controller reads), and home opens its dock seeded with the
 * fork source + reuse environment; the compose controller builds the fork
 * request on submit.
 */
export function useMessageActionHandlers({
  thread,
  quoteIntoComposer,
  editMessage,
}: UseMessageActionHandlersArgs): TimelineMessageActionHandlers {
  const router = useRouter();
  const { sdk } = useProfileClient();
  const [, prefStore] = useComposePreferences();
  const providersQuery = useSystemProviders({ enabled: thread !== undefined });
  const providerInfo = providersQuery.data?.find(
    (provider) => provider.id === thread?.providerId,
  );
  const canFork =
    thread !== undefined &&
    thread.archivedAt === null &&
    isThreadForkable(thread, providerInfo?.capabilities.supportsFork ?? false);
  const forkInFlightRef = useRef(false);

  const forkFromMessage = useCallback(
    async ({ sourceSeqEnd }: { sourceSeqEnd: number }) => {
      if (!thread || thread.environmentId === null || forkInFlightRef.current) {
        return;
      }
      forkInFlightRef.current = true;
      try {
        const executionOptions = await sdk.threads.defaultExecutionOptions({
          threadId: thread.id,
        });
        if (executionOptions === null) {
          toast.error("Could not fork", {
            description: "The thread's execution options are unavailable.",
          });
          return;
        }
        // Pin the compose picks to the source thread's options (web parity:
        // the fork seed writes the same preference keys).
        prefStore.setProviderId(thread.providerId);
        prefStore.setProviderSelection(thread.providerId, {
          model: executionOptions.model,
          reasoningLevel: executionOptions.reasoningLevel,
        });
        prefStore.setPermissionMode(executionOptions.permissionMode);
        prefStore.setServiceTier(executionOptions.serviceTier);
        prefStore.setLastProjectId(thread.projectId);
        router.navigate(
          newThreadHref(
            buildForkComposeParams({
              environmentId: thread.environmentId,
              projectId: thread.projectId,
              sourceSeqEnd,
              sourceThreadId: thread.id,
              sourceThreadTitle: getThreadDisplayTitle(thread),
            }),
          ),
        );
      } catch (error) {
        toast.error("Could not fork", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        forkInFlightRef.current = false;
      }
    },
    [prefStore, router, sdk, thread],
  );

  const isSideChat =
    thread !== undefined &&
    thread.originKind === "fork" &&
    thread.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    thread.sourceThreadId !== null;
  const sendToMain = useSendMessageToMainThread({
    mainThreadId: isSideChat ? thread.sourceThreadId : null,
    sideChatThreadId: thread?.id ?? null,
  });

  return useMemo<TimelineMessageActionHandlers>(
    () => ({
      ...(quoteIntoComposer ? { quoteIntoComposer } : {}),
      ...(editMessage ? { editMessage } : {}),
      ...(canFork
        ? {
            forkFromMessage: (target: { sourceSeqEnd: number }) => {
              void forkFromMessage(target);
            },
          }
        : {}),
      ...(sendToMain ? { sendToMainThread: sendToMain } : {}),
    }),
    [canFork, editMessage, forkFromMessage, quoteIntoComposer, sendToMain],
  );
}
