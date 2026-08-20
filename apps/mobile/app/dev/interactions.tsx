// Dev-only showcase: inert in production bundles (see app/e2e/reset.tsx).
import { Redirect } from "expo-router";
import { e2eModeEnabled } from "@/app-shell";
import { InteractionsShowcaseScreen } from "@/screens/dev/InteractionsShowcaseScreen";

export default function InteractionsRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <InteractionsShowcaseScreen />;
}
