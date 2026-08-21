import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Spinner, Text, type IconName } from "@/ui";

interface PickerTriggerProps {
  label: string;
  /** Leading glyph. */
  icon?: IconName;
  /** Custom leading node (a provider logo); wins over `icon`. */
  leading?: ReactNode;
  /** Muted second segment after the label (e.g. reasoning level). */
  detail?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Replaces the chevron with a spinner (catalog still loading). */
  loading?: boolean;
  /** Paint the warning tone (host offline, load failure). */
  tone?: "default" | "warning" | "destructive";
  /**
   * `ghost` (default): borderless, for the composer's pill rows. `outline`:
   * the bordered pill for pickers that stand alone on a settings screen.
   */
  variant?: "ghost" | "outline";
  testID?: string;
  /** The control's name; the spoken label becomes "<name>: <label>". */
  accessibilityLabel?: string;
}

/**
 * The composer's control pill: a compact pressable that opens a picker
 * sheet. Mirrors the web prompt-box option triggers (icon · label · chevron)
 * at touch size (36px). Ghost by default so a row of them reads as one
 * quiet line under the prompt.
 */
export function PickerTrigger({
  label,
  icon,
  leading,
  detail,
  onPress,
  disabled = false,
  loading = false,
  tone = "default",
  variant = "ghost",
  testID,
  accessibilityLabel,
}: PickerTriggerProps) {
  const { tokens } = useTheme();
  const foreground =
    tone === "warning"
      ? tokens.warningText
      : tone === "destructive"
        ? tokens.destructiveText
        : tokens.pillForeground;
  const interactive = Boolean(onPress) && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ? `${accessibilityLabel}: ${label}` : label
      }
      accessibilityState={{ disabled: !interactive }}
      disabled={!interactive}
      onPress={onPress}
      testID={testID}
      className={cn(
        "h-9 max-w-[220px] flex-row items-center gap-1.5 rounded-full px-2.5",
        variant === "outline" && "border border-pill-surface-border bg-secondary",
        interactive && "active:bg-state-hover",
        disabled && "opacity-50",
      )}
    >
      {leading ??
        (icon ? <Icon name={icon} size={16} color={tokens.pillIcon} /> : null)}
      <View className="min-w-0 shrink flex-row items-center gap-1">
        <Text
          variant="label"
          numberOfLines={1}
          className="shrink"
          style={{ color: foreground }}
        >
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" numberOfLines={1} className="shrink">
            {detail}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <Spinner size="small" color={tokens.mutedForeground} />
      ) : interactive ? (
        <Icon name="ChevronDown" size={14} color={tokens.mutedForeground} />
      ) : null}
    </Pressable>
  );
}
