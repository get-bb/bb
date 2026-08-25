import {
  getThreadListIndicatorLabel,
  type ThreadListIndicatorKind,
} from "@bb/client-core";
import { Image } from "expo-image";
import { View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import { useTheme } from "@/theme";
import { Spinner } from "@/ui";

const GLYPH_SIZE = 18;
const UNREAD_DOT_SIZE = 8;

type GlyphTone = "muted" | "destructive" | "warning";

/**
 * SF Symbol per indicator (filled variants where the status is a verdict).
 * The remaining kinds are drawn directly: `runtime` spins, `unread-success`
 * is the tinted dot, `none` is empty.
 */
const GLYPHS: Record<
  Exclude<ThreadListIndicatorKind, "none" | "runtime" | "unread-success">,
  { symbol: SFSymbol; tone: GlyphTone }
> = {
  "unread-error": { symbol: "xmark.circle.fill", tone: "destructive" },
  "waiting-for-input": { symbol: "questionmark.circle", tone: "warning" },
  "working-draft": { symbol: "pencil", tone: "muted" },
  workflow: {
    symbol: "point.3.connected.trianglepath.dotted",
    tone: "muted",
  },
  "background-agent": { symbol: "person.badge.plus", tone: "muted" },
  "background-command": { symbol: "terminal", tone: "muted" },
  "plan-mode": { symbol: "checklist", tone: "muted" },
  goal: { symbol: "target", tone: "muted" },
  draft: { symbol: "pencil", tone: "muted" },
};

/**
 * iOS status glyph of a thread row: SF Symbols through expo-image (the
 * `tintColor` must stay a token string), the unread dot in the tint, the
 * system spinner for a running thread. Metro picks this file on iOS;
 * `ThreadStatusGlyph.tsx` is the Hugeicons sibling. Precedence lives in
 * `resolveThreadListIndicator`; this only maps a kind to a glyph.
 */
export function ThreadStatusGlyph({ kind }: { kind: ThreadListIndicatorKind }) {
  const { tokens } = useTheme();
  const label = getThreadListIndicatorLabel(kind) ?? undefined;
  switch (kind) {
    case "none":
      return null;
    case "runtime":
      return (
        <View
          accessibilityLabel={label}
          style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
          className="items-center justify-center"
        >
          <Spinner size="small" color={tokens.mutedForeground} />
        </View>
      );
    case "unread-success":
      return (
        <View
          accessibilityLabel={label}
          style={{
            width: UNREAD_DOT_SIZE,
            height: UNREAD_DOT_SIZE,
            borderRadius: UNREAD_DOT_SIZE / 2,
            backgroundColor: tokens.primary,
          }}
        />
      );
    default: {
      const glyph = GLYPHS[kind];
      const color =
        glyph.tone === "destructive"
          ? tokens.destructive
          : glyph.tone === "warning"
            ? tokens.warning
            : tokens.mutedForeground;
      return (
        <Image
          source={`sf:${glyph.symbol}`}
          tintColor={color}
          contentFit="contain"
          style={{
            width: GLYPH_SIZE,
            height: GLYPH_SIZE,
            fontSize: GLYPH_SIZE,
            fontWeight: "600",
          }}
          accessible={label !== undefined}
          accessibilityLabel={label}
          accessibilityElementsHidden={label === undefined}
        />
      );
    }
  }
}
