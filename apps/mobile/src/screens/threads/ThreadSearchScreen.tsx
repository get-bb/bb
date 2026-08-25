import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import { Icon, Input, Text } from "@/ui";
import { ConnectionBanner } from "../shell/ConnectionBanner";
import { Screen } from "../shell/Screen";
import { SidebarActionsProvider } from "../sidebar";
import { ThreadSearchResults } from "./ThreadSearchResults";

const IS_IOS = process.env.EXPO_OS === "ios";

function SearchBody() {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const [query, setQuery] = useState("");
  return (
    <>
      {IS_IOS ? (
        <Stack.SearchBar
          placeholder="Search threads"
          autoFocus
          autoCapitalize="none"
          hideWhenScrolling={false}
          obscureBackground={false}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      ) : (
        <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
          <View className="relative flex-1">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search threads"
              autoFocus
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              className="pl-9"
              testID="thread-search-input"
            />
            <View
              pointerEvents="none"
              className="absolute bottom-0 left-3 top-0 justify-center"
            >
              <Icon name="Search" size={16} color={tokens.mutedForeground} />
            </View>
          </View>
        </View>
      )}
      <ThreadSearchResults
        query={query}
        ListHeaderComponent={<ConnectionBanner inset />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />
    </>
  );
}

/**
 * `/threads/search`: debounced full-text search, recent threads while
 * empty. On iOS home searches in place from its header search bar, so this
 * route mostly serves deep links and uses the same native search bar;
 * Android reaches it from the home header's search button.
 */
export function ThreadSearchScreen() {
  const { connection } = useProfiles();
  return (
    <Screen scroll={false} banner={false} testID="thread-search-screen">
      {connection ? (
        <SidebarActionsProvider>
          <SearchBody />
        </SidebarActionsProvider>
      ) : (
        <View className="p-4">
          <Text variant="caption">No active server.</Text>
        </View>
      )}
    </Screen>
  );
}
