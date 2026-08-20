import type { BuiltInThemeId } from "@bb/domain";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import type { ThemePreferenceStorage } from "@/theme/theme-preference";
import { SheetProvider } from "./Sheet";
import { Toaster } from "./Toast";

export interface UiProviderProps {
  children: ReactNode;
  /** Server palette (`appearance.themeId`); defaults to `default`. */
  palette?: BuiltInThemeId;
  storage?: ThemePreferenceStorage;
}

/**
 * Theme + sheet host + toaster in one wrapper. Must sit inside
 * `GestureHandlerRootView` (sheets) and `SafeAreaProvider` (sheet insets).
 */
export function UiProvider({ children, palette, storage }: UiProviderProps) {
  return (
    <ThemeProvider palette={palette} storage={storage}>
      <SheetProvider>
        {children}
        <Toaster />
      </SheetProvider>
    </ThemeProvider>
  );
}
