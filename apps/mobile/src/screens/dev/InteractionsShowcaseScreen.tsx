// Dev-only showcase for the pending-interaction banners, the prompt chip
// row and the queued messages list: synthetic payloads for every variant (approval subjects,
// user questions, the two plugin forms, unknown/malformed plugin
// interactions) rendered through the real components. Taps hit the real
// mutations against the active profile with invalid ids, so they exercise
// the inline error path. Not product UI.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import type { ThemeModePreference } from "@/theme/theme-preference";
import { Button, EmptyStatePanel, Text, toast } from "@/ui";
import { Screen } from "../shell/Screen";
import {
  ChildThreadPendingInteractions,
  PendingInteractionBanner,
} from "../thread/interactions";
import { ThreadPromptChips } from "../thread/cards/ThreadPromptStackChips";
import { QueuedMessagesList } from "../thread/queue";
import { LiveThreadInteractions } from "./LiveThreadInteractions";
import {
  buildInteractionFixtures,
  buildQueuedMessageFixtures,
  DEV_THREAD_ID,
} from "./interaction-fixtures";
import { buildPromptChipStateFixtures } from "./prompt-chip-fixtures";
import { buildPromptChipWorkFixtures } from "./work-row-fixtures";

const MODES: ThemeModePreference[] = ["system", "light", "dark"];

export function InteractionsShowcaseScreen() {
  const theme = useTheme();
  const { connection } = useProfiles();
  const [showSource, setShowSource] = useState(false);
  const fixtures = useMemo(() => buildInteractionFixtures(), []);
  const queued = useMemo(() => buildQueuedMessageFixtures(), []);
  const chipWork = useMemo(() => buildPromptChipWorkFixtures(), []);
  const chipState = useMemo(() => buildPromptChipStateFixtures(), []);
  if (!connection) {
    // The banners' mutations need the active profile's SDK client.
    return (
      <Screen testID="dev-interactions-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  const childItems = fixtures.slice(0, 2).map((fixture, index) => ({
    childThreadId: `${DEV_THREAD_ID}-child-${index}`,
    childTitle: `Child thread ${index + 1}`,
    interaction: fixture.interaction,
  }));
  return (
    <Screen contentStyle={{ gap: 20 }} testID="dev-interactions-screen">
      <View className="flex-row flex-wrap gap-2">
        {MODES.map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={theme.preference === mode ? "default" : "outline"}
            onPress={() => theme.setMode(mode)}
          >
            {mode}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          pressed={showSource}
          onPress={() => setShowSource((value) => !value)}
          testID="dev-interactions-source-toggle"
        >
          From child thread
        </Button>
      </View>
      <View className="gap-1">
        <Text variant="sectionLabel">Live thread</Text>
        <LiveThreadInteractions />
      </View>
      {fixtures.map((fixture) => (
        <View key={fixture.interaction.id} className="gap-1">
          <Text variant="sectionLabel">{fixture.title}</Text>
          <PendingInteractionBanner
            interaction={fixture.interaction}
            threadId={DEV_THREAD_ID}
            sourceThread={
              showSource
                ? { threadId: DEV_THREAD_ID, title: "Worker thread" }
                : undefined
            }
          />
        </View>
      ))}
      <View className="gap-1">
        <Text variant="sectionLabel">Child threads waiting</Text>
        <ChildThreadPendingInteractions items={childItems} />
      </View>
      <View className="gap-1">
        <Text variant="sectionLabel">Prompt chips</Text>
        <View className="px-3" testID="dev-prompt-chips">
          <ThreadPromptChips
            {...chipWork}
            {...chipState}
            onExitPlanMode={() => toast.info("Exit plan mode")}
            onClearGoal={() => toast.info("Clear goal")}
          />
        </View>
      </View>
      <View className="gap-1">
        <Text variant="sectionLabel">Queued messages</Text>
        <QueuedMessagesList
          threadId={DEV_THREAD_ID}
          queuedMessages={queued}
          onEdit={({ queuedMessageIndex }) =>
            toast.info(`Edit queued message ${queuedMessageIndex + 1}`)
          }
        />
      </View>
    </Screen>
  );
}
