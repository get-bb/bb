import {
  FiraCode_400Regular,
  FiraCode_500Medium,
  FiraCode_600SemiBold,
  FiraCode_700Bold,
} from "@expo-google-fonts/fira-code";
import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_600SemiBold_Italic,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { FONT_FAMILIES, ITALIC_FONT_FAMILIES } from "./fonts";

// Keep the native splash up until the fonts (and whatever else the root
// layout awaits) are ready; the root layout hides it after its own gates.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const FONT_SOURCES = {
  [FONT_FAMILIES.sans.regular]: Inter_400Regular,
  [FONT_FAMILIES.sans.medium]: Inter_500Medium,
  [FONT_FAMILIES.sans.semibold]: Inter_600SemiBold,
  [FONT_FAMILIES.sans.bold]: Inter_700Bold,
  [ITALIC_FONT_FAMILIES.regular]: Inter_400Regular_Italic,
  [ITALIC_FONT_FAMILIES.semibold]: Inter_600SemiBold_Italic,
  [FONT_FAMILIES.mono.regular]: FiraCode_400Regular,
  [FONT_FAMILIES.mono.medium]: FiraCode_500Medium,
  [FONT_FAMILIES.mono.semibold]: FiraCode_600SemiBold,
  [FONT_FAMILIES.mono.bold]: FiraCode_700Bold,
} as const;

/**
 * Loads Inter and Fira Code (the web app's `--font-sans` / `--font-mono`).
 * Returns `ready` once loaded, or after a load error (the app then renders
 * with system fonts rather than staying on the splash forever).
 */
export function useAppFonts(): { ready: boolean; error: Error | null } {
  const [loaded, error] = useFonts(FONT_SOURCES);
  const ready = loaded || error !== null;
  return { ready, error };
}
