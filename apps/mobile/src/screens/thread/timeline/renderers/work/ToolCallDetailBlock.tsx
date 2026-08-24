import type { TimelineToolArgs } from "@bb/server-contract";
import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { TERMINAL_FONT_SIZE, TERMINAL_LINE_HEIGHT } from "@/ansi";
import { Text } from "@/ui";
import { estimateToolHeaderLines, toolArgEntries } from "./work-row-model";

export interface ToolCallDetailBlockProps {
  toolName: string;
  args: TimelineToolArgs;
  output: string;
  /** Still pending: the output tail stays visible as bytes stream in. */
  streaming?: boolean;
  testID?: string;
}

/** Web `line-clamp-3` on the tool name + args header. */
const HEADER_COLLAPSED_LINES = 3;
const DEFAULT_MAX_OUTPUT_LINES = 24;

/**
 * Port of the web `ToolCallDetailBlock`: a card with the tool name and its
 * arguments (`key: value` lines, clamped to three lines until "Show more"),
 * then the raw output in monospace. Plain text (no ANSI): provider tool
 * output is not a terminal stream. The whole card sits at 70% opacity like
 * the terminal card.
 */
export const ToolCallDetailBlock = memo(function ToolCallDetailBlock({
  toolName,
  args,
  output,
  streaming = false,
  testID,
}: ToolCallDetailBlockProps) {
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const entries = useMemo(() => toolArgEntries(args), [args]);
  // The clamped header only gets a "Show more" affordance when it (most
  // likely) hides lines — web `useIsOverflowing`, estimated here.
  const headerOverflows =
    estimateToolHeaderLines(toolName, entries) > HEADER_COLLAPSED_LINES;
  const outputLines = useMemo(
    () =>
      output.trim().length > 0 ? output.replace(/\n$/, "").split("\n") : [],
    [output],
  );
  const hiddenOutputLines =
    !outputExpanded && outputLines.length > DEFAULT_MAX_OUTPUT_LINES
      ? outputLines.length - DEFAULT_MAX_OUTPUT_LINES
      : 0;
  // While streaming keep the tail (newest bytes); settled output keeps the
  // head so the reader starts from the top.
  const visibleOutput =
    hiddenOutputLines > 0
      ? streaming
        ? outputLines.slice(hiddenOutputLines)
        : outputLines.slice(0, DEFAULT_MAX_OUTPUT_LINES)
      : outputLines;
  const headerTextStyle = {
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: TERMINAL_LINE_HEIGHT,
  };

  return (
    <View
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={{ opacity: 0.7 }}
      testID={testID}
    >
      <View className="px-3 py-2.5">
        <Text
          variant="mono"
          style={headerTextStyle}
          numberOfLines={headerExpanded ? undefined : HEADER_COLLAPSED_LINES}
          testID="timeline-tool-args"
        >
          <Text variant="mono" weight="semibold" style={headerTextStyle}>
            {toolName}
          </Text>
          {entries.map((entry) => (
            <Text key={entry.key} variant="mono" style={headerTextStyle}>
              {"\n"}
              <Text
                variant="mono"
                tone="muted"
                style={headerTextStyle}
              >{`${entry.key}: `}</Text>
              {entry.value}
            </Text>
          ))}
        </Text>
        {headerOverflows || headerExpanded ? (
          <Pressable
            onPress={() => setHeaderExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: headerExpanded }}
            className="self-start pt-1 active:opacity-70"
            testID="timeline-tool-args-toggle"
          >
            <Text variant="chrome" tone="primary">
              {headerExpanded ? "Show less" : "Show more"}
            </Text>
          </Pressable>
        ) : null}
        {outputLines.length > 0 ? (
          <View className="mt-2 border-t border-border pt-2">
            {hiddenOutputLines > 0 && streaming ? (
              <Pressable
                onPress={() => setOutputExpanded(true)}
                accessibilityRole="button"
                className="pb-1 active:opacity-70"
              >
                <Text variant="chrome" tone="primary">
                  … {hiddenOutputLines.toLocaleString("en-US")} earlier lines
                </Text>
              </Pressable>
            ) : null}
            <ScrollView
              horizontal
              bounces={false}
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <View style={{ flexGrow: 1 }}>
                {visibleOutput.map((line, index) => (
                  <Text
                    key={index}
                    variant="mono"
                    numberOfLines={1}
                    style={headerTextStyle}
                  >
                    {line.length === 0 ? " " : line}
                  </Text>
                ))}
              </View>
            </ScrollView>
            {hiddenOutputLines > 0 && !streaming ? (
              <Pressable
                onPress={() => setOutputExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${hiddenOutputLines} more lines`}
                className="items-center border-t border-border pt-1.5 mt-1.5 active:opacity-70"
              >
                <Text variant="chrome" tone="primary">
                  Show {hiddenOutputLines.toLocaleString("en-US")} more lines
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
});
