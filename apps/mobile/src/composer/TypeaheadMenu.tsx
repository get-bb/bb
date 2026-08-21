import {
  providerCommandSection,
  type ProviderCommandSection,
} from "@bb/server-contract";
import type {
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "@bb/client-core";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Spinner, Text, type IconName } from "@/ui";
import { TYPEAHEAD_MAX_HEIGHT } from "./model";
import type { TypeaheadMenuModel } from "./useComposerTypeahead";

export interface TypeaheadMenuProps {
  menu: TypeaheadMenuModel;
  onPickMention: (suggestion: PromptMentionSuggestion) => void;
  onPickCommand: (suggestion: ProviderCommandSuggestion) => void;
  maxHeight?: number;
  testID?: string;
}

const COMMAND_SECTION_LABELS: Record<ProviderCommandSection, string> = {
  "agent-command": "Commands",
  skill: "Skills",
  "project-command": "Project commands",
  "user-command": "User commands",
};

function mentionIcon(suggestion: PromptMentionSuggestion): IconName {
  switch (suggestion.kind) {
    case "thread":
      return "UserRound";
    case "project":
      return "Folder";
    case "section":
      return "SectionAdd";
    case "plugin":
      return "ElectricPlugs";
    case "path":
      return suggestion.entryKind === "directory" ? "Folder" : "File";
  }
}

function mentionTitle(suggestion: PromptMentionSuggestion): string {
  switch (suggestion.kind) {
    case "thread":
      return suggestion.title?.trim() || suggestion.threadId;
    case "project":
      return suggestion.name;
    case "section":
      return suggestion.name;
    case "plugin":
      return suggestion.title;
    case "path":
      return suggestion.name;
  }
}

function mentionSubtitle(suggestion: PromptMentionSuggestion): string | null {
  switch (suggestion.kind) {
    case "thread":
      return suggestion.projectName ?? null;
    case "project":
      return "Project";
    case "section":
      return "Section";
    case "plugin":
      return suggestion.subtitle ?? suggestion.providerLabel;
    case "path":
      return suggestion.source === "thread-storage"
        ? `thread-storage:${suggestion.path}`
        : suggestion.path;
  }
}

function mentionSectionLabel(suggestion: PromptMentionSuggestion): string {
  switch (suggestion.kind) {
    case "thread":
      return "Threads";
    case "project":
      return "Projects";
    case "section":
      return "Sections";
    case "path":
      return "Files";
    case "plugin":
      return suggestion.providerLabel;
  }
}

interface MenuRow {
  key: string;
  icon: IconName;
  title: string;
  subtitle: string | null;
  section: string;
  onPress: () => void;
  testID: string;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text variant="sectionLabel" className="px-3 pb-1 pt-2">
      {label}
    </Text>
  );
}

const Row = memo(function Row({ row }: { row: MenuRow }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={row.title}
      testID={row.testID}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: pressed ? tokens.stateHover : "transparent",
      })}
    >
      <Icon name={row.icon} size={16} color={tokens.mutedForeground} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={1}>
          {row.title}
        </Text>
        {row.subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/**
 * The suggestion list for the active trigger (web `MentionMenu`): rows
 * grouped under section labels, hint / loading / error / empty states.
 * Rendered inline by the composer (above or below the input), never in a
 * sheet, so the keyboard stays up and typing keeps filtering.
 */
export function TypeaheadMenu({
  menu,
  onPickMention,
  onPickCommand,
  maxHeight = TYPEAHEAD_MAX_HEIGHT,
  testID = "composer-typeahead",
}: TypeaheadMenuProps) {
  const { tokens } = useTheme();
  const rows = useMemo((): MenuRow[] => {
    if (menu.kind === "command") {
      return menu.suggestions.map((suggestion, index) => ({
        key: `${suggestion.source}:${suggestion.name}`,
        icon: suggestion.source === "skill" ? "Zap" : "Terminal",
        title: `/${suggestion.name}`,
        subtitle: suggestion.description ?? suggestion.argumentHint,
        section: COMMAND_SECTION_LABELS[providerCommandSection(suggestion)],
        onPress: () => onPickCommand(suggestion),
        testID: `${testID}-row-${index}`,
      }));
    }
    return menu.suggestions.map((suggestion, index) => ({
      key: `${suggestion.kind}:${suggestion.replacement}:${
        suggestion.kind === "plugin" ? suggestion.itemId : ""
      }`,
      icon: mentionIcon(suggestion),
      title: mentionTitle(suggestion),
      subtitle: mentionSubtitle(suggestion),
      section: mentionSectionLabel(suggestion),
      onPress: () => onPickMention(suggestion),
      testID: `${testID}-row-${index}`,
    }));
  }, [menu, onPickCommand, onPickMention, testID]);

  let status: string | null = null;
  if (menu.kind === "mention" && menu.state === "hint") {
    status = "Type to search threads, files, projects…";
  } else if (menu.state === "loading" && rows.length === 0) {
    status = "Searching…";
  } else if (menu.state === "error" && rows.length === 0) {
    status = "Could not load suggestions";
  } else if (menu.state === "results" && rows.length === 0) {
    status = "No matches";
  }

  return (
    <View
      testID={testID}
      accessibilityRole="menu"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.popover,
        overflow: "hidden",
        maxHeight,
        shadowColor: tokens.shadowColor,
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      {status !== null ? (
        <View className="flex-row items-center gap-2 px-3 py-3">
          {menu.state === "loading" ? <Spinner /> : null}
          <Text variant="caption" testID={`${testID}-status`}>
            {status}
          </Text>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          style={{ maxHeight }}
          contentContainerStyle={{ paddingBottom: 4 }}
        >
          {rows.map((row, index) => {
            const previous = rows[index - 1];
            const startsSection = previous?.section !== row.section;
            return (
              <View key={row.key}>
                {startsSection ? <SectionHeader label={row.section} /> : null}
                <Row row={row} />
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
