// The page's half of the bb mobile shell bridge. Every export works in a
// plain browser: a missing bridge is the normal case.
export {
  canOpenNativeScreen,
  getNativeShell,
  isInsideNativeShell,
  resetNativeShellForTests,
  shellHaptic,
  shellOpenExternal,
  shellOpenNative,
  shellReportPath,
  shellReportReady,
  shellSetBadge,
  shellShare,
  type NativeShell,
} from "./native-shell";
export { NativeShellReporter } from "./NativeShellReporter";
export {
  useNativeSafeArea,
  useNativeShell,
  useNativeShellResume,
} from "./use-native-shell";
