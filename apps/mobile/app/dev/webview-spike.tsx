// Dev-only Phase 0 spike: inert in production bundles (see app/e2e/reset.tsx).
import { Redirect } from "expo-router";
import { e2eModeEnabled } from "@/app-shell";
import { WebViewSpikeScreen } from "@/screens/dev/WebViewSpikeScreen";

export default function WebViewSpikeRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <WebViewSpikeScreen />;
}
