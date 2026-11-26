import type { ReactNode } from "react";
import { PLUGIN_CONTENT_ATTRIBUTE, usePluginContentProps } from "@/lib/host-ui";

export function PluginContent({ children }: { children: ReactNode }) {
  const pluginContentProps = usePluginContentProps();
  if (!(PLUGIN_CONTENT_ATTRIBUTE in pluginContentProps)) return children;
  return (
    <span {...pluginContentProps} className="contents">
      {children}
    </span>
  );
}
