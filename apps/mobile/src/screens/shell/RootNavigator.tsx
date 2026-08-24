import { Stack } from "expo-router";
import { useTheme } from "@/theme";

/**
 * Root native stack: home (the thread list) at the bottom, thread /
 * settings / dev screens pushed on top with native headers in bb's colors.
 * Home sets its own title and header buttons.
 */
export function RootNavigator() {
  const { tokens, fonts } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: tokens.background },
        headerShadowVisible: false,
        headerTintColor: tokens.foreground,
        headerTitleStyle: {
          fontFamily: fonts.sans.semibold,
          fontWeight: "600",
          color: tokens.foreground,
        },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: tokens.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "bb" }} />
      <Stack.Screen name="threads/[id]" options={{ title: "Thread" }} />
      <Stack.Screen name="threads/search" options={{ title: "Search" }} />
      <Stack.Screen name="threads/[id]/files" options={{ title: "Files" }} />
      <Stack.Screen
        name="threads/[id]/terminal/index"
        options={{ title: "Terminals" }}
      />
      <Stack.Screen
        name="threads/[id]/terminal/[terminalId]"
        options={{ title: "Terminal", orientation: "all" }}
      />
      <Stack.Screen name="settings/index" options={{ title: "Settings" }} />
      <Stack.Screen
        name="settings/archived"
        options={{ title: "Archived threads" }}
      />
      <Stack.Screen
        name="settings/server"
        options={{ title: "Server status" }}
      />
      <Stack.Screen
        name="settings/servers/index"
        options={{ title: "Servers" }}
      />
      <Stack.Screen
        name="settings/servers/add"
        options={{ title: "Add server" }}
      />
      <Stack.Screen name="settings/general" options={{ title: "General" }} />
      <Stack.Screen
        name="settings/appearance"
        options={{ title: "Appearance" }}
      />
      <Stack.Screen
        name="settings/experiments"
        options={{ title: "Experiments" }}
      />
      <Stack.Screen name="settings/usage" options={{ title: "Usage limits" }} />
      <Stack.Screen name="settings/updates" options={{ title: "Updates" }} />
      <Stack.Screen
        name="settings/machines/index"
        options={{ title: "Machines" }}
      />
      <Stack.Screen
        name="settings/machines/[hostId]"
        options={{ title: "Machine" }}
      />
      <Stack.Screen
        name="settings/plugins/index"
        options={{ title: "Plugins" }}
      />
      <Stack.Screen
        name="settings/plugins/browse"
        options={{ title: "Browse plugins" }}
      />
      <Stack.Screen
        name="settings/plugins/[pluginId]/index"
        options={{ title: "Plugin" }}
      />
      <Stack.Screen
        name="settings/plugins/[pluginId]/logs"
        options={{ title: "Plugin logs" }}
      />
      <Stack.Screen
        name="settings/marketplaces"
        options={{ title: "Marketplaces" }}
      />
      <Stack.Screen
        name="settings/skills/index"
        options={{ title: "Skills" }}
      />
      <Stack.Screen
        name="settings/skills/[skillId]"
        options={{ title: "Skill" }}
      />
      <Stack.Screen
        name="settings/skills/registry/index"
        options={{ title: "Browse skills" }}
      />
      <Stack.Screen
        name="settings/skills/registry/[registrySkillId]"
        options={{ title: "Skill" }}
      />
      <Stack.Screen name="connect/index" options={{ title: "bb connect" }} />
      <Stack.Screen name="dev/ui" options={{ title: "UI gallery" }} />
      <Stack.Screen
        name="dev/markdown"
        options={{ title: "Markdown showcase" }}
      />
      <Stack.Screen name="dev/diff" options={{ title: "Diff + terminal" }} />
      <Stack.Screen name="dev/work-rows" options={{ title: "Work rows" }} />
      <Stack.Screen name="dev/composer" options={{ title: "Composer" }} />
      <Stack.Screen name="dev/spike" options={{ title: "Runtime spike" }} />
      <Stack.Screen
        name="dev/connect-spike"
        options={{ title: "Connect spike" }}
      />
      <Stack.Screen name="e2e/reset" options={{ headerShown: false }} />
      <Stack.Screen name="projects/new" options={{ title: "New project" }} />
      <Stack.Screen
        name="projects/[id]/settings"
        options={{ title: "Project settings" }}
      />
      <Stack.Screen
        name="projects/[id]/threads/[threadId]"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
