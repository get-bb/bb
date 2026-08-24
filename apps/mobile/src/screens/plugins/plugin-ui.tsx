import type { ReactNode } from "react";
import { View } from "react-native";
import type { PluginRowSignal, PluginStatusTone } from "@/data/plugins";
import { useTheme } from "@/theme";
import { Icon, Pill, Text } from "@/ui";

/** Card-styled section with a label, shared by the plugin / extension screens. */
export function SettingsSection({
  title,
  description,
  children,
  testID,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View className="gap-1" testID={testID}>
      <Text variant="sectionLabel" className="pb-1">
        {title}
      </Text>
      {description ? (
        <Text variant="caption" className="pb-2">
          {description}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </View>
    </View>
  );
}

/** A `label: value` definition row inside a card. */
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
  return (
    <View className="flex-row items-start gap-3 px-4 py-2.5" testID={testID}>
      <Text variant="caption" className="w-28 shrink-0">
        {label}
      </Text>
      <Text
        variant={mono ? "mono" : "body"}
        className="min-w-0 flex-1"
        selectable
      >
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
      <Text variant="caption">{children}</Text>
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

/** A tinted banner (status condition + recovery, third-party warnings). */
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
      className="flex-row gap-3 rounded-lg border border-border bg-card px-4 py-3"
      testID={testID}
    >
      <Icon name={icon} size={18} color={color} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        {body ? <Text variant="caption">{body}</Text> : null}
      </View>
    </View>
  );
}
