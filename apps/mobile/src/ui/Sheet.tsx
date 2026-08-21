import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetModalProvider,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { scrimBaseColor } from "@/theme/scrim";
import { Text } from "./Text";
import { useDeferredRealization } from "./useDeferredRealization";

/** Imperative handle a mounted `<Sheet>` registers with its controller. */
export interface SheetHandle {
  present: () => void;
  dismiss: () => void;
}

/**
 * Stable object from `useSheet()`; pass it to one `<Sheet controller>` (or
 * `<ActionSheet controller>`) and call `present()` / `dismiss()` from
 * handlers. Calls before the sheet mounts are ignored.
 */
export interface SheetController extends SheetHandle {
  /** @internal set by the mounted Sheet. */
  attach: (handle: SheetHandle | null) => void;
}

function createSheetController(): SheetController {
  let handle: SheetHandle | null = null;
  return {
    attach: (next) => {
      handle = next;
    },
    present: () => handle?.present(),
    dismiss: () => handle?.dismiss(),
  };
}

/** Creates the controller for one `<Sheet>`. */
export function useSheet(): SheetController {
  const [controller] = useState(createSheetController);
  return controller;
}

/** Wrap the app root (inside `GestureHandlerRootView`) once. */
export const SheetProvider = BottomSheetModalProvider;

/**
 * Lets an ancestor (the composer) learn when a sheet mounted in its subtree
 * presents or dismisses: presenting dismisses the keyboard, and the composer
 * wants to stay expanded through a picker and refocus afterwards.
 */
export const SheetPresenceContext = createContext<{
  onPresenceChange: (open: boolean) => void;
} | null>(null);

export interface SheetProps extends Pick<
  BottomSheetModalProps,
  | "snapPoints"
  | "enableDynamicSizing"
  | "maxDynamicContentSize"
  | "onDismiss"
  | "name"
  | "stackBehavior"
  | "enableContentPanningGesture"
> {
  controller: SheetController;
  children: ReactNode;
  /** Optional header title (semibold, with a bottom hairline). */
  title?: string;
  /**
   * `view` (default) sizes to content; `scroll` puts children in a
   * BottomSheetScrollView; `custom` renders children directly for
   * BottomSheetFlatList/SectionList bodies.
   */
  layout?: "view" | "scroll" | "custom";
  /** Called when the sheet finishes presenting/dismissing (index ≥ 0 = open). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Realize children two frames after presenting (default). Turn off for
   * tiny sheets whose content is cheaper than the resize it would cause.
   */
  deferContent?: boolean;
}

/**
 * Bottom sheet built on @gorhom/bottom-sheet. Content is realized two frames
 * after presenting so the slide-in starts on an empty body, and retained
 * afterwards (the web persistent drawer contract). Requires `<SheetProvider>`
 * up the tree.
 */
export function Sheet({
  controller,
  children,
  title,
  layout = "view",
  snapPoints,
  enableDynamicSizing,
  maxDynamicContentSize,
  onDismiss,
  onOpenChange,
  name,
  stackBehavior,
  enableContentPanningGesture,
  deferContent = true,
}: SheetProps) {
  const modalRef = useRef<BottomSheetModal>(null);
  const { tokens, radii, mode } = useTheme();
  const scrimColor = scrimBaseColor(mode, tokens);
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(false);
  const realized = useDeferredRealization(presented);
  const presence = useContext(SheetPresenceContext);
  const onPresenceChange = presence?.onPresenceChange;
  useEffect(() => {
    if (!onPresenceChange) return;
    onPresenceChange(presented);
    return () => {
      // Unmounting while presented counts as dismissed.
      if (presented) onPresenceChange(false);
    };
  }, [onPresenceChange, presented]);

  useEffect(() => {
    controller.attach({
      present: () => {
        // A keyboard left open by the screen underneath would cover the
        // sheet (the modal mounts below it); sheet-local inputs refocus.
        Keyboard.dismiss();
        setPresented(true);
        modalRef.current?.present();
      },
      dismiss: () => modalRef.current?.dismiss(),
    });
    return () => controller.attach(null);
  }, [controller]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.45}
        pressBehavior="close"
        style={[props.style, { backgroundColor: scrimColor }]}
      />
    ),
    [scrimColor],
  );

  const dynamic = enableDynamicSizing ?? snapPoints === undefined;
  const backgroundStyle = useMemo(
    () => ({
      backgroundColor: tokens.popover,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderWidth: 1,
      borderColor: tokens.border,
    }),
    [tokens, radii],
  );
  const handleIndicatorStyle = useMemo(
    () => ({ backgroundColor: tokens.input, width: 36 }),
    [tokens],
  );

  const header = title ? (
    <View
      className="border-b border-border-hairline px-4 pb-3 pt-1"
      style={{ backgroundColor: tokens.popover }}
    >
      <Text variant="heading" numberOfLines={1}>
        {title}
      </Text>
    </View>
  ) : null;

  const body = realized || !deferContent ? children : <View className="h-24" />;
  const bottomPad = { paddingBottom: Math.max(insets.bottom, 12) };

  return (
    <BottomSheetModal
      ref={modalRef}
      name={name}
      stackBehavior={stackBehavior}
      snapPoints={snapPoints}
      enableDynamicSizing={dynamic}
      maxDynamicContentSize={maxDynamicContentSize}
      enablePanDownToClose
      // Off while the body hosts its own vertical drag (reorder lists), so
      // the sheet does not follow the finger; the handle still closes it.
      enableContentPanningGesture={enableContentPanningGesture}
      // The library marks the content container as one accessibility element
      // ("Bottom Sheet"), which hides every row from VoiceOver and from UI
      // automation. Expose the children instead.
      accessible={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      topInset={insets.top}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onChange={(index) => onOpenChange?.(index >= 0)}
      onDismiss={() => {
        setPresented(false);
        onDismiss?.();
      }}
    >
      {layout === "custom" ? (
        <>
          {header}
          {body}
        </>
      ) : layout === "scroll" ? (
        // The header rides inside the scroll view (pinned) so dynamic sizing
        // measures it: outside, the sheet came up short by the header height
        // and the last row plus the bottom inset slid under the home
        // indicator.
        <BottomSheetScrollView
          contentContainerStyle={bottomPad}
          stickyHeaderIndices={header ? [0] : undefined}
          // Let a tap on a row/button land while the keyboard is up
          // (otherwise the first tap only dismisses the keyboard).
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {body}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={bottomPad}>
          {header}
          {body}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
}

export {
  BottomSheetFlatList as SheetFlatList,
  BottomSheetScrollView as SheetScrollView,
  BottomSheetTextInput as SheetTextInput,
};
