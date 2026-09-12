import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetModalProvider,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withAlpha } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import { scrimBaseColor } from "@/theme/scrim";
import { useDeferredRealization } from "./useDeferredRealization";

const IS_IOS = process.env.EXPO_OS === "ios";

export const SHEET_CORNER_RADIUS = IS_IOS ? 38 : 12;
const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 5;
const GRABBER_ALPHA = 0.3;

export interface SheetHandle {
  present: () => void;
  dismiss: () => void;
}

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

export function useSheet(): SheetController {
  const [controller] = useState(createSheetController);
  return controller;
}

export const SheetProvider = BottomSheetModalProvider;

export interface SheetProps extends Pick<BottomSheetModalProps, "onDismiss"> {
  controller: SheetController;
  children: ReactNode;
}

export function Sheet({ controller, children, onDismiss }: SheetProps) {
  const modalRef = useRef<BottomSheetModal>(null);
  const { tokens, mode } = useTheme();
  const scrimColor = scrimBaseColor(mode, tokens);
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(false);
  const realized = useDeferredRealization(presented);

  useEffect(() => {
    controller.attach({
      present: () => {
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

  const backgroundStyle = useMemo(
    () => ({
      backgroundColor: tokens.surfaceGrouped,
      borderTopLeftRadius: SHEET_CORNER_RADIUS,
      borderTopRightRadius: SHEET_CORNER_RADIUS,
      borderCurve: "continuous" as const,
    }),
    [tokens.surfaceGrouped],
  );
  const handleIndicatorStyle = useMemo(
    () => ({
      backgroundColor: withAlpha(tokens.foreground, GRABBER_ALPHA),
      width: GRABBER_WIDTH,
      height: GRABBER_HEIGHT,
      borderRadius: GRABBER_HEIGHT / 2,
    }),
    [tokens],
  );

  const body = realized ? children : <View className="h-24" />;
  const bottomPad = { paddingBottom: Math.max(insets.bottom, 12) };

  return (
    <BottomSheetModal
      ref={modalRef}
      enableDynamicSizing
      enablePanDownToClose
      accessible={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      topInset={insets.top}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={() => {
        setPresented(false);
        onDismiss?.();
      }}
    >
      <BottomSheetView style={bottomPad}>{body}</BottomSheetView>
    </BottomSheetModal>
  );
}
