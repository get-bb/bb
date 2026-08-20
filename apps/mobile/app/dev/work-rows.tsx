// Dev-only showcase: inert in production bundles (see app/e2e/reset.tsx).
import { Redirect } from "expo-router";
import { e2eModeEnabled } from "@/app-shell";
import { WorkRowsShowcaseScreen } from "@/screens/dev/WorkRowsShowcaseScreen";

export default function WorkRowsRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <WorkRowsShowcaseScreen />;
}
