import { View } from "react-native";
import type { PluginRowSignal, PluginStatusTone } from "@/data/plugins";
import { useTheme } from "@/theme";
import { GROUPED_CARD_RADIUS, Icon, Pill, Text } from "@/ui";

/** The grouped section shared by the plugin / extension screens. */
export { SettingsSection } from "../settings/SettingsRows";

/** Values up to this length sit on the row's right; longer ones wrap under the label. */
const INLINE_VALUE_MAX_LENGTH = 28;

/**
 * A `label: value` definition row inside a card. Short values read like an
 * iOS value cell (label left, muted value right); long or mono values
 * (sources, schedules, paths) wrap under the label. Values are selectable.
 */
export function DetailRow({
  label,
  value,
  mono = false,
  testID,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testID?: string;
}) {
  const inline = !mono && value.length <= INLINE_VALUE_MAX_LENGTH;
  if (inline) {
    return (
      <View
        className="min-h-[44px] flex-row items-center gap-3 px-4 py-2.5"
        testID={testID}
      >
        <Text variant="bodyLarge" className="shrink" numberOfLines={2}>
          {label}
        </Text>
        <Text
          variant="bodyLarge"
          tone="muted"
          className="min-w-0 flex-1 text-right"
          numberOfLines={1}
          selectable
        >
          {value}
        </Text>
      </View>
    );
  }
  return (
    <View className="min-h-[44px] gap-0.5 px-4 py-2.5" testID={testID}>
      <Text variant="bodyLarge">{label}</Text>
      <Text variant={mono ? "mono" : "body"} tone="muted" selectable>
        {value}
      </Text>
    </View>
  );
}

/** Muted card body copy (empty states, explanations). */
export function CardNote({
  children,
  testID,
}: {
  children: string;
  testID?: string;
}) {
  return (
    <View className="px-4 py-3" testID={testID}>
      <Text variant="footnote" tone="muted">
        {children}
      </Text>
    </View>
  );
}

function toneColor(
  tone: PluginStatusTone,
  tokens: { destructiveText: string; warningText: string },
): string {
  return tone === "error" ? tokens.destructiveText : tokens.warningText;
}

/** The one signal a plugin row earns (update pill or status glyph + label). */
export function PluginSignalPill({
  signal,
  testID,
}: {
  signal: PluginRowSignal;
  testID?: string;
}) {
  const { tokens } = useTheme();
  if (signal.kind === "update") {
    return (
      <View testID={testID}>
        <Pill variant="emphasis" size="sm">
          {`Update ${signal.version}`}
        </Pill>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1" testID={testID}>
      <Icon
        name={signal.icon}
        size={14}
        color={toneColor(signal.tone, tokens)}
      />
      <Text
        variant="caption"
        tone={signal.tone === "error" ? "destructive" : "warning"}
        numberOfLines={1}
      >
        {signal.label}
      </Text>
    </View>
  );
}

/** A grouped card carrying a status condition + recovery, or a third-party warning. */
export function NoticeCard({
  tone,
  icon,
  title,
  body,
  testID,
}: {
  tone: PluginStatusTone | "info";
  icon:
    | "AlertTriangle"
    | "AlertCircle"
    | "CircleX"
    | "FileQuestion"
    | "Settings"
    | "RotateCcw"
    | "Info"
    | "Lock";
  title: string;
  body?: string | null;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const color =
    tone === "info" ? tokens.mutedForeground : toneColor(tone, tokens);
  return (
    <View
      className="flex-row gap-3 bg-surface-grouped-cell px-4 py-3"
      style={{ borderRadius: GROUPED_CARD_RADIUS, borderCurve: "continuous" }}
      testID={testID}
    >
      <Icon name={icon} size={20} color={color} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text variant="headline">{title}</Text>
        {body ? (
          <Text variant="footnote" tone="muted" selectable>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
