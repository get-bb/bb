// Dev-only showcase for the timeline work-row renderers: synthetic
// TimelineRow fixtures for every `work:<kind>` (including the shapes the
// fake e2e provider cannot produce) pushed through the real list model
// (`useTimelineListItems` → registry renderers), so grouping, auto-expand,
// compact intents and depth indents behave as in the thread screen. Not
// product UI.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import type { ThemeModePreference } from "@/theme/theme-preference";
import { Button, EmptyStatePanel, Text } from "@/ui";
import { Screen } from "../shell/Screen";
import {
  getTimelineRowRenderer,
  TimelineRowHostProvider,
  useTimelineListItems,
} from "../thread/timeline";
// Registers the renderers (side effect) before the first cell renders.
import "../thread/timeline/renderers/index";
import { buildWorkRowFixtureSections } from "./work-row-fixtures";

const MODES: ThemeModePreference[] = ["system", "light", "dark"];
const EMPTY_TURN_CHILDREN = new Map();
const THREAD_ID = "dev-thread";

function FixtureSection({
  title,
  rows,
  scopeActive,
}: {
  title: string;
  rows: ReturnType<typeof buildWorkRowFixtureSections>[number]["rows"];
  scopeActive: boolean;
}) {
  const { items, toggleRow } = useTimelineListItems({
    rows,
    scopeActive,
    turnChildren: EMPTY_TURN_CHILDREN,
    resetKey: title,
  });
  return (
    <View className="gap-1">
      <Text variant="sectionLabel" className="px-4 pb-1">
        {title}
      </Text>
      <View className="rounded-lg border border-border-hairline bg-background py-1">
        {items.map((item) => {
          const Renderer = getTimelineRowRenderer(item.kind);
          const rowId = item.viewRow.id;
          return (
            <Renderer
              key={item.key}
              item={item}
              expanded={item.expanded}
              onToggle={() => toggleRow(rowId)}
              threadId={THREAD_ID}
              projectId="dev-project"
            />
          );
        })}
      </View>
    </View>
  );
}

export function WorkRowsShowcaseScreen() {
  const theme = useTheme();
  const { connection } = useProfiles();
  const [scopeActive, setScopeActive] = useState(true);
  const sections = useMemo(() => buildWorkRowFixtureSections(), []);
  if (!connection) {
    // The row host needs the active profile (server URL for image routes).
    return (
      <Screen testID="dev-work-rows-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return (
    <Screen
      contentStyle={{ paddingHorizontal: 0, gap: 20 }}
      testID="dev-work-rows-screen"
    >
      <View className="flex-row flex-wrap gap-2 px-4">
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
          pressed={scopeActive}
          onPress={() => setScopeActive((value) => !value)}
          testID="dev-work-rows-scope-active"
        >
          Thread running
        </Button>
      </View>
      <TimelineRowHostProvider
        threadId={THREAD_ID}
        workspaceRootPath="/Users/dev/repo"
        threadOriginKind={null}
      >
        {sections.map((section) => (
          <FixtureSection
            key={section.title}
            title={section.title}
            rows={section.rows}
            scopeActive={scopeActive}
          />
        ))}
      </TimelineRowHostProvider>
    </Screen>
  );
}
