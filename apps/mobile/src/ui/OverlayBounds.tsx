import {
  createContext,
  createRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export interface OverlayBoundsValue {
  /** The native view a floating overlay measures its anchor against. */
  ref: RefObject<View | null>;
  /**
   * Increments on every layout pass of the bounds view (keyboard frame,
   * rotation), so an anchored overlay re-measures the room it has.
   */
  layoutVersion: number;
}

/** Without a provider the ref stays detached, so a consumer measures nothing. */
const DETACHED_BOUNDS: OverlayBoundsValue = {
  ref: createRef<View>(),
  layoutVersion: 0,
};

const OverlayBoundsContext = createContext<OverlayBoundsValue>(DETACHED_BOUNDS);

export interface OverlayBoundsProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The region a floating overlay anchored to a descendant may cover: the
 * screen content under the native header and above the keyboard. The
 * composer's typeahead measures its card against this view so the list
 * never extends under the header, where the navigator chrome would hide
 * (and block taps on) its first rows. Without a provider the bounds ref
 * stays detached and an overlay keeps its fixed maximum height.
 */
export function OverlayBounds({ children, style, testID }: OverlayBoundsProps) {
  const ref = useRef<View>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const handleLayout = useCallback(() => {
    setLayoutVersion((version) => version + 1);
  }, []);
  const value = useMemo<OverlayBoundsValue>(
    () => ({ ref, layoutVersion }),
    [layoutVersion],
  );
  return (
    <OverlayBoundsContext.Provider value={value}>
      <View
        ref={ref}
        // Android flattens plain Views out of the native tree; the
        // `measureLayout` target has to exist there.
        collapsable={false}
        style={style}
        onLayout={handleLayout}
        testID={testID}
      >
        {children}
      </View>
    </OverlayBoundsContext.Provider>
  );
}

export function useOverlayBounds(): OverlayBoundsValue {
  return useContext(OverlayBoundsContext);
}
