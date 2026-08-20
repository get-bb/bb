// Dev-only showcase: inert in production bundles (see app/e2e/reset.tsx).
import { Redirect } from "expo-router";
import { e2eModeEnabled } from "@/app-shell";
import { ComposerShowcaseScreen } from "@/screens/dev/ComposerShowcaseScreen";

export default function ComposerRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <ComposerShowcaseScreen />;
}
