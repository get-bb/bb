import type { ReactNode } from "react";
/** Plugin configuration always belongs to Settings, independent of Tools Hub. */
export function PluginSettingsCompatibilityRoute({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
