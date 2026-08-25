import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useProfiles } from "@/app-shell/ProfilesProvider";
import { EmptyStatePanel } from "@/ui";
import { Screen } from "../shell/Screen";
import { threadTerminalHref } from "../shell/hrefs";
import { TerminalSessionsList } from "./TerminalSessionsList";

/**
 * `/threads/[id]/terminal`: the thread's terminals (list + Start), the route
 * behind the panel's Terminal tab for deep links and full-screen use. A
 * grouped page: the session cards sit on the grouped background.
 */
export function ThreadTerminalsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { connection } = useProfiles();
  const router = useRouter();
  const openTerminal = useCallback(
    (terminalId: string) => {
      if (!id) return;
      router.push(threadTerminalHref(id, terminalId));
    },
    [id, router],
  );
  return (
    <>
      <Stack.Screen options={{ title: "Terminals" }} />
      <Screen scroll={false} testID="thread-terminals-screen">
        {!id || !connection ? (
          <View className="p-4">
            <EmptyStatePanel>No active server.</EmptyStatePanel>
          </View>
        ) : (
          <View className="flex-1 bg-surface-grouped">
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <TerminalSessionsList
                listScope={{ kind: "thread", threadId: id }}
                createScope={{ kind: "thread", threadId: id }}
                onOpenTerminal={openTerminal}
                surface="grouped"
                testID="thread-terminals"
              />
            </ScrollView>
          </View>
        )}
      </Screen>
    </>
  );
}
