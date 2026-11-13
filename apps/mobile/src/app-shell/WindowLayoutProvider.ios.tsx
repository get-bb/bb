import type { ShellWindowLayout } from "@bb/mobile-bridge";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import {
  useCallback,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import { parseNativeWindowLayout, windowLayoutKey } from "@/lib/window-layout";
import { WindowLayoutContext } from "./window-layout-context";

interface WindowLayoutModule {
  supportsRailExpansion: boolean;
  setVerticalBarDisabled(disabled: boolean): Promise<void>;
  refreshSafeArea(): void;
}

type ProbeProps = ViewProps & {
  onWindowLayout: (event: NativeSyntheticEvent<unknown>) => void;
};

const windowLayoutModule =
  requireOptionalNativeModule<WindowLayoutModule>("BbWindowLayout");
const WindowLayoutProbe: ComponentType<ProbeProps> | null =
  windowLayoutModule === null
    ? null
    : requireNativeView<ProbeProps>("BbWindowLayout");

export const supportsRailExpansion =
  windowLayoutModule?.supportsRailExpansion === true;

export async function setRailExpanded(expanded: boolean): Promise<void> {
  if (!supportsRailExpansion || !windowLayoutModule)
    throw new Error("Native rail expansion is unavailable");
  await windowLayoutModule.setVerticalBarDisabled(expanded);
}

export function refreshWindowSafeArea(): void {
  windowLayoutModule?.refreshSafeArea();
}

export function WindowLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<ShellWindowLayout | null>(null);

  const onWindowLayout = useCallback((event: NativeSyntheticEvent<unknown>) => {
    const next = parseNativeWindowLayout(event.nativeEvent);
    setLayout((previous) =>
      windowLayoutKey(previous) === windowLayoutKey(next) ? previous : next,
    );
  }, []);

  if (WindowLayoutProbe === null) return children;
  return (
    <WindowLayoutContext.Provider value={layout}>
      <View style={styles.root}>
        <WindowLayoutProbe
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          onWindowLayout={onWindowLayout}
        />
        {children}
      </View>
    </WindowLayoutContext.Provider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
