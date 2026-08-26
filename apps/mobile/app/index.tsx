import { Redirect } from "expo-router";
import { useWebViewShellEnabled } from "@/lib/shell";
import { HomeScreen } from "@/screens";

/**
 * Home is either the native thread list or the WebView shell, decided by the
 * client-local switch in Settings -> General. Both ship in the same binary
 * while the shell is proven, so a user can turn it off after a bad build.
 */
export default function HomeRoute() {
  const [webViewShell] = useWebViewShellEnabled();
  if (webViewShell) return <Redirect href="/webview" />;
  return <HomeScreen />;
}
