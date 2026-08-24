import { Image, type ImageLoadEventData } from "expo-image";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, Spinner, Text } from "@/ui";
import {
  clampLightboxScale,
  clampLightboxTranslation,
  LIGHTBOX_DOUBLE_TAP_SCALE,
  LIGHTBOX_MIN_SCALE,
  type LightboxImage as LightboxImageItem,
  type LightboxState,
} from "./lightbox-model";

export interface ImageLightboxProps {
  state: LightboxState | null;
  onClose: () => void;
  onStep: (direction: "previous" | "next") => void;
}

interface Size {
  width: number;
  height: number;
}

/** Dragging the unzoomed image this far (or flicking it) dismisses. */
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY = 900;
/** Horizontal swipe on an unzoomed image steps to the neighbour. */
const STEP_DISTANCE_PX = 72;
const SPRING = { damping: 22, stiffness: 220, mass: 0.7 };
const ZOOMED_EPSILON = 0.02;
// Photo-viewer chrome is black/white in both modes (web image-lightbox:
// `bg-black/45 text-white`), not a palette token: a tinted scrim would colour
// the photograph.
const BACKDROP_COLOR = "#000000";
const CHROME_COLOR = "#ffffff";
const CHROME_BUTTON_BACKGROUND = "rgba(0, 0, 0, 0.45)";

function fitContentSize(natural: Size | null, viewport: Size): Size {
  if (
    natural === null ||
    natural.width <= 0 ||
    natural.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return viewport;
  }
  const ratio = Math.min(
    viewport.width / natural.width,
    viewport.height / natural.height,
  );
  return { width: natural.width * ratio, height: natural.height * ratio };
}

interface LightboxSlideProps {
  image: LightboxImageItem;
  viewport: Size;
  /** Fitted content size, published for the gesture clamps. */
  contentWidth: SharedValue<number>;
  contentHeight: SharedValue<number>;
}

/**
 * One image: owns its load state (keyed by `src` at the call site, so a new
 * image mounts fresh) and publishes its fitted size to the gesture clamps.
 */
function LightboxSlide({
  image,
  viewport,
  contentWidth,
  contentHeight,
}: LightboxSlideProps) {
  const [natural, setNatural] = useState<Size | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const content = fitContentSize(natural, viewport);

  useEffect(() => {
    contentWidth.set(content.width);
    contentHeight.set(content.height);
  }, [content.height, content.width, contentHeight, contentWidth]);

  const handleLoad = (event: ImageLoadEventData) => {
    const { width, height } = event.source;
    setLoading(false);
    if (width > 0 && height > 0) setNatural({ width, height });
  };

  if (failed) {
    return (
      <View style={styles.center} pointerEvents="none">
        <Text className="text-sm" style={{ color: CHROME_COLOR }}>
          Could not load this image.
        </Text>
      </View>
    );
  }
  return (
    <>
      <Image
        source={{ uri: image.src }}
        contentFit="contain"
        style={{ width: content.width, height: content.height }}
        onLoad={handleLoad}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        accessible
        accessibilityLabel={image.alt || "Attached image"}
        transition={100}
      />
      {loading ? (
        <View style={styles.center} pointerEvents="none">
          <Spinner color={CHROME_COLOR} />
        </View>
      ) : null}
    </>
  );
}

/**
 * Full-screen image viewer (web `ImageLightbox`): pinch to zoom, pan while
 * zoomed, double-tap to toggle zoom, drag down (or tap) to dismiss, swipe or
 * arrow buttons to move between the message's images. One instance is
 * mounted per timeline by `TimelineRowHostProvider`; rows open it through
 * `useTimelineRowHost().openImageLightbox`.
 */
export function ImageLightbox({ state, onClose, onStep }: ImageLightboxProps) {
  const insets = useSafeAreaInsets();
  const image = state === null ? null : (state.images[state.index] ?? null);
  const multiple = state !== null && state.images.length > 1;
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);

  useEffect(() => {
    viewportWidth.set(viewport.width);
    viewportHeight.set(viewport.height);
  }, [viewport.height, viewport.width, viewportHeight, viewportWidth]);

  const src = image?.src ?? null;
  // Every image (and every open) starts at fit scale, centred.
  useEffect(() => {
    scale.set(1);
    savedScale.set(1);
    translateX.set(0);
    translateY.set(0);
    savedTranslateX.set(0);
    savedTranslateY.set(0);
    dismissY.set(0);
  }, [
    dismissY,
    savedScale,
    savedTranslateX,
    savedTranslateY,
    scale,
    src,
    translateX,
    translateY,
  ]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.set(clampLightboxScale(savedScale.get() * event.scale));
    })
    .onEnd(() => {
      const next = scale.get();
      if (next <= LIGHTBOX_MIN_SCALE + ZOOMED_EPSILON) {
        scale.set(withSpring(LIGHTBOX_MIN_SCALE, SPRING));
        savedScale.set(LIGHTBOX_MIN_SCALE);
        translateX.set(withSpring(0, SPRING));
        translateY.set(withSpring(0, SPRING));
        savedTranslateX.set(0);
        savedTranslateY.set(0);
        return;
      }
      savedScale.set(next);
      const clamped = clampLightboxTranslation({
        translation: { x: translateX.get(), y: translateY.get() },
        scale: next,
        contentSize: {
          width: contentWidth.get(),
          height: contentHeight.get(),
        },
        viewportSize: {
          width: viewportWidth.get(),
          height: viewportHeight.get(),
        },
      });
      translateX.set(withSpring(clamped.x, SPRING));
      translateY.set(withSpring(clamped.y, SPRING));
      savedTranslateX.set(clamped.x);
      savedTranslateY.set(clamped.y);
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onUpdate((event) => {
      if (savedScale.get() > LIGHTBOX_MIN_SCALE + ZOOMED_EPSILON) {
        translateX.set(savedTranslateX.get() + event.translationX);
        translateY.set(savedTranslateY.get() + event.translationY);
        return;
      }
      dismissY.set(event.translationY);
      translateX.set(multiple ? event.translationX * 0.6 : 0);
    })
    .onEnd((event) => {
      if (savedScale.get() > LIGHTBOX_MIN_SCALE + ZOOMED_EPSILON) {
        const clamped = clampLightboxTranslation({
          translation: { x: translateX.get(), y: translateY.get() },
          scale: savedScale.get(),
          contentSize: {
            width: contentWidth.get(),
            height: contentHeight.get(),
          },
          viewportSize: {
            width: viewportWidth.get(),
            height: viewportHeight.get(),
          },
        });
        translateX.set(withSpring(clamped.x, SPRING));
        translateY.set(withSpring(clamped.y, SPRING));
        savedTranslateX.set(clamped.x);
        savedTranslateY.set(clamped.y);
        return;
      }
      const shouldDismiss =
        Math.abs(event.translationY) > DISMISS_DISTANCE_PX ||
        Math.abs(event.velocityY) > DISMISS_VELOCITY;
      if (shouldDismiss) {
        dismissY.set(
          withTiming(event.translationY > 0 ? 600 : -600, { duration: 160 }),
        );
        runOnJS(onClose)();
        return;
      }
      if (multiple && Math.abs(event.translationX) > STEP_DISTANCE_PX) {
        runOnJS(onStep)(event.translationX < 0 ? "next" : "previous");
      }
      dismissY.set(withSpring(0, SPRING));
      translateX.set(withSpring(0, SPRING));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (savedScale.get() > LIGHTBOX_MIN_SCALE + ZOOMED_EPSILON) {
        scale.set(withSpring(LIGHTBOX_MIN_SCALE, SPRING));
        savedScale.set(LIGHTBOX_MIN_SCALE);
        translateX.set(withSpring(0, SPRING));
        translateY.set(withSpring(0, SPRING));
        savedTranslateX.set(0);
        savedTranslateY.set(0);
        return;
      }
      const next = LIGHTBOX_DOUBLE_TAP_SCALE;
      // Zoom toward the tapped point so it stays under the finger.
      const focalX = event.x - viewportWidth.get() / 2;
      const focalY = event.y - viewportHeight.get() / 2;
      const clamped = clampLightboxTranslation({
        translation: { x: -focalX * (next - 1), y: -focalY * (next - 1) },
        scale: next,
        contentSize: {
          width: contentWidth.get(),
          height: contentHeight.get(),
        },
        viewportSize: {
          width: viewportWidth.get(),
          height: viewportHeight.get(),
        },
      });
      scale.set(withSpring(next, SPRING));
      savedScale.set(next);
      translateX.set(withSpring(clamped.x, SPRING));
      translateY.set(withSpring(clamped.y, SPRING));
      savedTranslateX.set(clamped.x);
      savedTranslateY.set(clamped.y);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const transformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() + dismissY.get() },
      { scale: scale.get() },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0.35, 1 - Math.abs(dismissY.get()) / 400),
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };

  return (
    <Modal
      visible={state !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: BACKDROP_COLOR },
            backdropStyle,
          ]}
          testID="image-lightbox"
        >
          <GestureDetector gesture={gesture}>
            <View style={styles.fill} onLayout={handleLayout}>
              {image !== null && viewport.width > 0 ? (
                <Animated.View style={[styles.center, transformStyle]}>
                  <LightboxSlide
                    key={image.src}
                    image={image}
                    viewport={viewport}
                    contentWidth={contentWidth}
                    contentHeight={contentHeight}
                  />
                </Animated.View>
              ) : null}
            </View>
          </GestureDetector>
          <View
            pointerEvents="box-none"
            style={[styles.chromeTop, { paddingTop: insets.top + 8 }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close image"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [
                styles.chromeButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              testID="image-lightbox-close"
            >
              <Icon name="X" size={20} color={CHROME_COLOR} />
            </Pressable>
            {multiple && state !== null ? (
              <Text
                className="text-xs"
                style={{ color: CHROME_COLOR }}
                accessibilityLiveRegion="polite"
              >
                {`${state.index + 1} / ${state.images.length}`}
              </Text>
            ) : (
              <View />
            )}
            <View style={styles.chromeSpacer} />
          </View>
          {multiple ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.chromeBottom,
                { paddingBottom: insets.bottom + 12 },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous image"
                onPress={() => onStep("previous")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.chromeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                testID="image-lightbox-previous"
              >
                <Icon name="ChevronLeft" size={22} color={CHROME_COLOR} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next image"
                onPress={() => onStep("next")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.chromeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                testID="image-lightbox-next"
              >
                <Icon name="ChevronRight" size={22} color={CHROME_COLOR} />
              </Pressable>
            </View>
          ) : null}
          {image !== null && image.alt.length > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.caption,
                { bottom: insets.bottom + (multiple ? 64 : 16) },
              ]}
            >
              <Text
                className="text-xs"
                style={{ color: CHROME_COLOR, opacity: 0.8 }}
                numberOfLines={1}
              >
                {image.alt}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  chromeTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  chromeBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  chromeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: CHROME_BUTTON_BACKGROUND,
  },
  chromeSpacer: { width: 44, height: 44 },
  caption: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
});
