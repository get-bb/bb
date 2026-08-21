import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { usePickerSheetMaxHeight } from "@/screens/pickers";
import { useTheme } from "@/theme";
import {
  cn,
  Icon,
  Sheet,
  ShimmerIcon,
  Spinner,
  Text,
  useSheet,
  type IconName,
  type SheetHandle,
} from "@/ui";

export interface PromptChipAction {
  label: string;
  onPress: () => void;
  pending: boolean;
  /** Trailing glyph; defaults to the dismiss X. */
  icon?: IconName;
  testID?: string;
}

interface PromptChipBaseProps {
  icon: IconName;
  /** Glyph color; defaults to the pill icon token (foreground while `live`). */
  iconColor?: string;
  /** Replaces the glyph with a custom leading node (the PR status glyphs). */
  leading?: ReactNode;
  label: string;
  /** Muted segment after the label ("0/4 agents", "3/7"). */
  detail?: string;
  /** Trailing action (exit plan mode / clear goal / dismiss). */
  action?: PromptChipAction | null;
  /** Sweep the web shine band across the glyph (a live activity). */
  live?: boolean;
  /** Names the chip for the screen reader (and titles its sheet). */
  title: string;
  /** Widest the label may grow before it truncates. */
  labelMaxWidth?: number;
  testID?: string;
}

type PromptChipProps = PromptChipBaseProps &
  (
    | {
        /**
         * Sheet body; a tap presents the sheet. The function form receives
         * the sheet so a row that navigates away can dismiss it first.
         */
        children: ReactNode | ((sheet: SheetHandle) => ReactNode);
        onPress?: never;
      }
    | {
        /** A tap runs this instead of presenting a sheet (navigation). */
        onPress: () => void;
        children?: never;
      }
  );

const DEFAULT_LABEL_MAX_WIDTH = 180;

/**
 * One chip in the prompt-stack row: glyph (shimmering while live), label,
 * muted detail, optional trailing action. A tap opens a bottom sheet with
 * the body the web card shows expanded, or runs `onPress` for chips that
 * navigate (the related-thread chip).
 */
export function PromptChip({
  icon,
  iconColor,
  leading,
  label,
  detail,
  action,
  live = false,
  title,
  labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH,
  testID,
  children,
  onPress,
}: PromptChipProps) {
  const { tokens } = useTheme();
  const sheet = useSheet();
  const maxHeight = usePickerSheetMaxHeight();
  return (
    <>
      <View
        className="h-9 flex-row items-center overflow-hidden rounded-full border border-pill-surface-border bg-surface-raised-solid"
        testID={testID}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${label}${detail ? ` ${detail}` : ""}`}
          onPress={onPress ?? sheet.present}
          className={cn(
            "h-full flex-row items-center gap-1.5 pl-3",
            action ? "pr-2" : "pr-3",
            "active:bg-state-hover",
          )}
        >
          {leading ??
            (live ? (
              <ShimmerIcon
                name={icon}
                size={14}
                color={iconColor ?? tokens.foreground}
              />
            ) : (
              <Icon
                name={icon}
                size={14}
                color={iconColor ?? tokens.pillIcon}
              />
            ))}
          <Text
            variant="label"
            numberOfLines={1}
            style={{ maxWidth: labelMaxWidth }}
          >
            {label}
          </Text>
          {detail ? (
            <Text variant="caption" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </Pressable>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.pending }}
            disabled={action.pending}
            onPress={action.onPress}
            className="h-full w-8 items-center justify-center border-l border-pill-surface-border active:bg-state-hover"
            testID={action.testID}
          >
            {action.pending ? (
              <Spinner size="small" color={tokens.mutedForeground} />
            ) : (
              <Icon
                name={action.icon ?? "X"}
                size={14}
                color={tokens.mutedForeground}
              />
            )}
          </Pressable>
        ) : null}
      </View>
      {children === undefined ? null : (
        <Sheet
          controller={sheet}
          title={title}
          layout="scroll"
          maxDynamicContentSize={maxHeight}
        >
          <View
            className="px-4 pb-2 pt-3"
            testID={testID ? `${testID}-sheet` : undefined}
          >
            {typeof children === "function" ? children(sheet) : children}
          </View>
        </Sheet>
      )}
    </>
  );
}
