import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { haptic } from "@/lib/haptics";
import { usePickerSheetMaxHeight } from "@/screens/pickers";
import { useTheme } from "@/theme";
import {
  cn,
  GlassSurface,
  Icon,
  NativeMenu,
  Sheet,
  ShimmerIcon,
  Spinner,
  Text,
  useLiquidGlass,
  useSheet,
  type IconName,
  type NativeMenuAction,
  type SheetHandle,
} from "@/ui";

const IS_IOS = process.env.EXPO_OS === "ios";
const CHIP_HEIGHT = 36;
/**
 * The capsule: on iOS 26 the shape is the Liquid Glass itself (the chips
 * float over the timeline, so they refract it); elsewhere the fill and
 * border below are painted into the same shape.
 */
const CHIP_SHAPE: ViewStyle = {
  height: CHIP_HEIGHT,
  borderRadius: CHIP_HEIGHT / 2,
  borderCurve: "continuous",
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
};

export interface PromptChipAction {
  label: string;
  onPress: () => void;
  pending: boolean;
  /** Trailing glyph; defaults to the dismiss X. */
  icon?: IconName;
  /** Ends something (exit plan mode, clear goal): red in the native menu. */
  destructive?: boolean;
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
const GLYPH_SIZE = 14;
/** iOS 17+: the live glyph pulses (the SF Symbol effect); older iOS shows it still. */
const LIVE_EFFECT = { effect: "pulse", repeat: -1 } as const;

/**
 * One chip in the prompt-stack row: glyph (pulsing on iOS / shimmering
 * elsewhere while live), label, muted detail, optional trailing action. A
 * tap on the text opens a bottom sheet with the body the web card shows
 * expanded, or runs `onPress` for chips that navigate (the related-thread
 * chip). On iOS the trailing action — an icon-only segment, the one shape a
 * `NativeMenu` may wrap — opens a one-item native menu (destructive when it
 * ends a mode), so an "exit" is never a single accidental tap.
 *
 * The capsule is a `GlassSurface`: Liquid Glass on iOS 26 (the chip floats
 * over the timeline), the raised fill with the pill border everywhere else.
 * Glass is translucent over whatever scrolls under it, so with glass the
 * detail segment and the trailing glyph drop their muted tone for the full
 * foreground; the warning / destructive tints stay as they are.
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
  const glass = useLiquidGlass();
  const sheet = useSheet();
  const maxHeight = usePickerSheetMaxHeight();
  const open = () => {
    haptic("selection");
    if (onPress) onPress();
    else sheet.present();
  };
  /** The secondary tone: muted on a solid capsule, full foreground on glass. */
  const secondaryColor = glass ? tokens.foreground : tokens.mutedForeground;
  const chipFallbackStyle: ViewStyle = {
    backgroundColor: tokens.surfaceRaisedSolid,
    borderWidth: 1,
    borderColor: tokens.pillSurfaceBorder,
  };
  const glyph =
    leading ??
    (live ? (
      IS_IOS ? (
        <Icon
          name={icon}
          size={GLYPH_SIZE}
          color={iconColor ?? tokens.foreground}
          effect={LIVE_EFFECT}
        />
      ) : (
        <ShimmerIcon
          name={icon}
          size={GLYPH_SIZE}
          color={iconColor ?? tokens.foreground}
        />
      )
    ) : (
      <Icon
        name={icon}
        size={GLYPH_SIZE}
        color={iconColor ?? tokens.pillIcon}
      />
    ));
  const actionGlyph = action ? (
    action.pending ? (
      <Spinner size="small" color={secondaryColor} />
    ) : (
      <Icon
        name={action.icon ?? "X"}
        size={GLYPH_SIZE}
        weight="semibold"
        color={secondaryColor}
      />
    )
  ) : null;
  const menuActions: NativeMenuAction[] = action
    ? [
        {
          key: "action",
          label: action.label,
          icon: action.icon ?? "X",
          destructive: action.destructive,
          disabled: action.pending,
          onPress: () => {
            haptic(action.destructive ? "warning" : "selection");
            action.onPress();
          },
        },
      ]
    : [];
  return (
    <>
      <GlassSurface
        glassStyle="regular"
        style={CHIP_SHAPE}
        fallbackStyle={chipFallbackStyle}
        testID={testID}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${label}${detail ? ` ${detail}` : ""}`}
          onPress={open}
          className={cn(
            "h-full flex-row items-center gap-1.5 pl-3",
            action ? "pr-2" : "pr-3",
            IS_IOS ? "active:bg-state-active" : "active:bg-state-hover",
          )}
        >
          {glyph}
          <Text
            variant="label"
            numberOfLines={1}
            style={{ maxWidth: labelMaxWidth }}
          >
            {label}
          </Text>
          {detail ? (
            // Footnote (foreground) on glass, the muted caption on a fill.
            <Text
              variant={glass ? "footnote" : "caption"}
              numberOfLines={1}
              numeric
            >
              {detail}
            </Text>
          ) : null}
        </Pressable>
        {action && IS_IOS ? (
          // The menu host is the accessible element (label, role, state,
          // testID); the glyph segment inside it is sized explicitly because
          // the host measures its content rather than the chip.
          <NativeMenu
            actions={menuActions}
            disabled={action.pending}
            accessibilityLabel={action.label}
            testID={action.testID}
          >
            <View className="h-9 w-8 items-center justify-center border-l border-pill-surface-border">
              {actionGlyph}
            </View>
          </NativeMenu>
        ) : action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.pending }}
            disabled={action.pending}
            onPress={action.onPress}
            className="h-full w-8 items-center justify-center border-l border-pill-surface-border active:bg-state-hover"
            testID={action.testID}
          >
            {actionGlyph}
          </Pressable>
        ) : null}
      </GlassSurface>
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
