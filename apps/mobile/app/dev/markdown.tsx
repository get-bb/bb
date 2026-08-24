// Dev-only showcase: inert in production bundles (see app/e2e/reset.tsx).
import { Redirect } from "expo-router";
import { e2eModeEnabled } from "@/app-shell";
import { MarkdownShowcaseScreen } from "@/screens/dev/MarkdownShowcaseScreen";

export default function MarkdownRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <MarkdownShowcaseScreen />;
}
