import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { cn, Text } from "@/ui";
import {
  AnsiSpansText,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from "./AnsiText";
import { ansiToLines } from "./ansi-to-spans";
import {
  selectTerminalTail,
  TERMINAL_DEFAULT_MAX_LINES,
} from "./terminal-output";

export interface TerminalOutputBlockProps {
  /** Raw command output; ANSI escapes are rendered, cursor codes stripped. */
  output: string;
  /** Shown above the output, clamped to two lines until tapped. */
  commandLine?: string;
  exitCode?: number | null;
  metadataLines?: readonly string[];
  /**
   * Whether the producing row is still pending. Collapsed output keeps the
   * tail, so newly streamed lines stay visible.
   */
  streaming?: boolean;
  /** Visible line cap before "N earlier lines"; `Infinity` disables it. */
  maxLines?: number;
  className?: string;
  testID?: string;
}

/**
 * Command card mirroring the web `TerminalOutputBlock`: command line,
 * metadata, ANSI-colored output in a horizontally scrolling monospace block
 * that collapses to its tail with an "N earlier lines" toggle, exit code.
 * The web dims the whole card to 70%; so does this one.
 */
export const TerminalOutputBlock = memo(function TerminalOutputBlock({
  output,
  commandLine,
  exitCode = null,
  metadataLines = [],
  streaming = false,
  maxLines = TERMINAL_DEFAULT_MAX_LINES,
  className,
  testID,
}: TerminalOutputBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [commandExpanded, setCommandExpanded] = useState(false);
  const lines = useMemo(
    () => (output.length > 0 ? ansiToLines(output) : []),
    [output],
  );
  const { visible, hiddenLines } = useMemo(
    () => selectTerminalTail(lines, maxLines, expanded),
    [lines, maxLines, expanded],
  );
  const hasOutput = lines.length > 0;
  const hasHeader = Boolean(commandLine) || metadataLines.length > 0;

  return (
    <View
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
      style={{ opacity: 0.7 }}
      testID={testID}
      accessibilityState={streaming ? { busy: true } : undefined}
    >
      <View className="px-3 py-2">
        {commandLine ? (
          <Pressable
            onPress={() => setCommandExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={
              commandExpanded ? "Collapse command" : "Expand command"
            }
          >
            <Text
              variant="mono"
              className="text-xs text-foreground"
              numberOfLines={commandExpanded ? undefined : 2}
              testID={testID ? `${testID}-command` : undefined}
            >
              {commandLine}
            </Text>
          </Pressable>
        ) : null}
        {metadataLines.map((line, index) => (
          <Text
            key={`${index}:${line}`}
            variant="mono"
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {line}
          </Text>
        ))}
        {hasOutput ? (
          <View className={cn(hasHeader && "mt-1.5")}>
            {hiddenLines > 0 ? (
              <Pressable
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${hiddenLines} earlier lines`}
                className="self-start rounded-sm py-0.5 active:bg-state-hover"
                testID={testID ? `${testID}-show-earlier` : undefined}
              >
                <Text variant="chrome" tone="primary">
                  … {hiddenLines.toLocaleString("en-US")} earlier lines
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
              <View
                style={{ flexGrow: 1 }}
                testID={testID ? `${testID}-output` : undefined}
              >
                {visible.map((spans, index) => (
                  <AnsiSpansText
                    key={index}
                    spans={spans}
                    fontSize={TERMINAL_FONT_SIZE}
                    lineHeight={TERMINAL_LINE_HEIGHT}
                    numberOfLines={1}
                  />
                ))}
              </View>
            </ScrollView>
            {expanded && lines.length > maxLines ? (
              <Pressable
                onPress={() => setExpanded(false)}
                accessibilityRole="button"
                accessibilityLabel="Collapse output"
                className="self-start rounded-sm py-0.5 active:bg-state-hover"
              >
                <Text variant="chrome" tone="primary">
                  Collapse
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {exitCode !== null ? (
          <Text
            variant="mono"
            className={cn(
              "text-xs text-muted-foreground",
              (hasOutput || commandLine) && "mt-1.5",
            )}
            testID={testID ? `${testID}-exit-code` : undefined}
          >
            exit code {exitCode}
          </Text>
        ) : null}
      </View>
    </View>
  );
});
