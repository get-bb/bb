import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  useChildThreadPendingInteractions,
  type ChildThreadPendingAttentionSource,
} from "@/data/interactions";
import {
  getLatestPendingInteraction,
  useChildThreads,
  useThreadPendingInteractions,
  useThreadQueuedMessages,
} from "@/data/thread-detail";
import { getThreadDisplayTitle, useThread } from "@/data/threads";
import { Button, Input, Text, toast } from "@/ui";
import { threadHref } from "../shell/hrefs";
import { ThreadChildThreadsChip } from "../thread/context/ThreadContextChips";
import { PendingInteractionBanner } from "../thread/interactions";
import { QueuedMessagesList } from "../thread/queue";

function LiveThread({ threadId }: { threadId: string }) {
  const router = useRouter();
  const thread = useThread(threadId);
  const interactions = useThreadPendingInteractions(threadId);
  const queued = useThreadQueuedMessages(threadId);
  const children = useChildThreads(threadId);
  const childSources = useMemo<ChildThreadPendingAttentionSource[]>(
    () =>
      (children.data ?? []).map((child) => ({
        id: child.id,
        title: getThreadDisplayTitle(child),
        hasPendingInteraction: child.hasPendingInteraction,
      })),
    [children.data],
  );
  const childItems = useChildThreadPendingInteractions(childSources);
  const latest = getLatestPendingInteraction(interactions.data);
  return (
    <View className="gap-3" testID="dev-live-thread">
      <Text variant="caption" testID="dev-live-thread-status">
        {thread.data
          ? `${getThreadDisplayTitle(thread.data)} · ${thread.data.runtime.displayStatus} · ${interactions.data?.length ?? 0} pending · ${queued.data?.length ?? 0} queued`
          : thread.error
            ? `Could not load ${threadId}`
            : "Loading…"}
      </Text>
      {latest ? (
        <PendingInteractionBanner interaction={latest} threadId={threadId} />
      ) : (
        <Text variant="caption" testID="dev-live-thread-no-interaction">
          No pending interaction.
        </Text>
      )}
      <View className="flex-row">
        <ThreadChildThreadsChip
          layout={{ kind: "hidden" }}
          childPendingInteractions={childItems}
          onOpenThread={(id) => router.push(threadHref(id))}
        />
      </View>
      <QueuedMessagesList
        threadId={threadId}
        queuedMessages={queued.data ?? []}
        onEdit={({ queuedMessageIndex }) =>
          toast.info(`Edit queued message ${queuedMessageIndex + 1}`)
        }
      />
    </View>
  );
}

/**
 * Live section of the interactions showcase: paste a thread id and the real
 * banner / child rows / queue for that thread render here against the
 * active profile. Lets the interaction and queue surfaces be exercised
 * on-device before the thread screen wires them.
 */
export function LiveThreadInteractions() {
  const [draft, setDraft] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Input
          mono
          value={draft}
          onChangeText={setDraft}
          placeholder="thr_…"
          autoCapitalize="none"
          className="flex-1"
          testID="dev-live-thread-input"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={draft.trim().length === 0}
          onPress={() => setThreadId(draft.trim())}
          testID="dev-live-thread-load"
        >
          Load
        </Button>
      </View>
      {threadId ? <LiveThread key={threadId} threadId={threadId} /> : null}
    </View>
  );
}
