import {
  assertNever,
  durationToCompactString,
  formatDiffStatsText,
  type TimelineTitle,
  type TimelineTitleDecoration,
  type TimelineTitleSegment,
  type TimelineTitleTone,
} from "@bb/thread-view";
import { useEffect, useState, type ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { cn, ShimmerText, Text } from "@/ui";

/**
 * Native rendering of a `@bb/thread-view` `TimelineTitle` (port of the web
 * TimelineTitleView): one row of segments that each carry their own em /
 * shimmer / accent / truncate flags, followed by the decorations (duration
 * ticking live while pending, status annotations, diff stats). Segment
 * links/actions are not interactive yet (Phase 4b/6 wire navigation).
 */

export interface TimelineTitleViewProps {
  title: TimelineTitle;
  style?: StyleProp<ViewStyle>;
}

function segmentClassName(
  segment: TimelineTitleSegment,
  tone: TimelineTitleTone,
): string {
  if (segment.accent !== undefined) {
    switch (segment.accent) {
      case "muted":
        return "text-muted-foreground";
      case "subtle":
        return "text-subtle-foreground";
      case "file":
        return segment.em
          ? "font-medium text-timeline-accent"
          : "text-timeline-accent";
      default:
        return assertNever(segment.accent);
    }
  }
  if (segment.em) {
    switch (tone) {
      case "default":
        // Emphasized targets sit at medium weight, dimmed so the machinery
        // around a file path recedes (web: font-medium text-foreground/70).
        return "font-medium text-foreground/70";
      case "summary":
        return "text-subtle-foreground";
      default:
        return assertNever(tone);
    }
  }
  switch (tone) {
    case "default":
      return "text-muted-foreground";
    case "summary":
      return "text-subtle-foreground";
    default:
      return assertNever(tone);
  }
}

function decorationClassName(tone: TimelineTitleTone): string {
  switch (tone) {
    case "default":
      return "text-muted-foreground";
    case "summary":
      return "text-subtle-foreground";
    default:
      return assertNever(tone);
  }
}

/** Ticks elapsed time once a second while the work is still pending. */
function LiveDurationText({
  startedAt,
  className,
}: {
  startedAt: number;
  className: string;
}) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    const interval = setInterval(
      () => setElapsed(Date.now() - startedAt),
      1000,
    );
    return () => clearInterval(interval);
  }, [startedAt]);
  // Stay empty until the elapsed time is visible (>1s) to avoid flicker on
  // row entry.
  if (elapsed <= 1_000) return null;
  return (
    <Text className={className} numberOfLines={1}>
      {durationToCompactString(elapsed)}
    </Text>
  );
}

function renderDecoration(
  decoration: TimelineTitleDecoration,
  index: number,
  tone: TimelineTitleTone,
  destructiveText: string,
): ReactElement | null {
  const base = cn("text-sm", decorationClassName(tone));
  const mono = "font-mono text-xs text-subtle-foreground";
  switch (decoration.kind) {
    case "duration": {
      const className = decoration.em
        ? cn(
            "text-sm",
            segmentClassName(
              { text: "", em: true, shimmer: false, truncate: false },
              tone,
            ),
          )
        : base;
      if (decoration.completedAt !== null) {
        return (
          <Text key={`d${index}`} className={className} numberOfLines={1}>
            {durationToCompactString(
              decoration.completedAt - decoration.startedAt,
            )}
          </Text>
        );
      }
      return (
        <LiveDurationText
          key={`d${index}`}
          startedAt={decoration.startedAt}
          className={className}
        />
      );
    }
    case "status": {
      const durationText =
        decoration.durationMs === null
          ? null
          : durationToCompactString(decoration.durationMs);
      const emphasized = decoration.status === "error" && decoration.emphasis;
      return (
        <View key={`d${index}`} className="flex-row items-baseline gap-1">
          {durationText ? (
            <Text className={mono} numberOfLines={1}>
              {durationText}
            </Text>
          ) : null}
          <Text
            className={mono}
            style={emphasized ? { color: destructiveText } : undefined}
            numberOfLines={1}
          >
            {decoration.status}
          </Text>
        </View>
      );
    }
    case "summary-status": {
      const parts: string[] = [];
      if (decoration.errorCount > 0) {
        parts.push(
          `${decoration.errorCount} ${decoration.errorCount === 1 ? "error" : "errors"}`,
        );
      }
      if (decoration.interruptedCount > 0) {
        parts.push(`${decoration.interruptedCount} interrupted`);
      }
      if (parts.length === 0) return null;
      return (
        <Text key={`d${index}`} className={mono} numberOfLines={1}>
          {parts.join(", ")}
        </Text>
      );
    }
    case "diff-stats": {
      if (tone === "summary") {
        const text = formatDiffStatsText({
          added: decoration.added,
          removed: decoration.removed,
          hideZero: true,
        });
        if (text.length === 0) return null;
        return (
          <Text key={`d${index}`} className={base} numberOfLines={1}>
            {text}
          </Text>
        );
      }
      return (
        <View key={`d${index}`} className="flex-row items-baseline gap-1">
          {decoration.added > 0 ? (
            <Text className="font-mono text-xs text-diff-added">
              +{decoration.added}
            </Text>
          ) : null}
          {decoration.removed > 0 ? (
            <Text className="font-mono text-xs text-diff-removed">
              -{decoration.removed}
            </Text>
          ) : null}
        </View>
      );
    }
    default:
      return assertNever(decoration);
  }
}

export function TimelineTitleView({ title, style }: TimelineTitleViewProps) {
  const { tokens } = useTheme();
  return (
    <View
      className="min-w-0 flex-row items-baseline gap-x-1 overflow-hidden"
      style={style}
      accessibilityLabel={title.plain}
    >
      {title.segments.map((segment, index) => {
        const className = cn("text-sm", segmentClassName(segment, title.tone));
        // Truncating segments shrink inside the row; the rest keep their width.
        const sizing = segment.truncate
          ? { flexShrink: 1, minWidth: 0 }
          : { flexShrink: 0 };
        if (segment.shimmer) {
          return (
            <ShimmerText
              key={`s${index}`}
              className={className}
              containerStyle={sizing}
              numberOfLines={1}
            >
              {segment.text}
            </ShimmerText>
          );
        }
        return (
          <Text
            key={`s${index}`}
            className={className}
            style={sizing}
            numberOfLines={1}
          >
            {segment.text}
          </Text>
        );
      })}
      {title.decorations.map((decoration, index) =>
        renderDecoration(decoration, index, title.tone, tokens.destructiveText),
      )}
    </View>
  );
}
