import { useMemo, useState } from "react";
import {
  useCliCommandStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { localhostLinkRewriteDescription } from "@/lib/localhost-link-rewrite-description";
import { usePluginSlots } from "@/lib/plugin-slots";
import type { SettingsSearchCondition } from "./settings-search";

export function useSettingsSearchConditions(): ReadonlySet<SettingsSearchCondition> {
  const {
    diffRenderers,
    experimentalSidebarNavigations,
    fileOpeners,
    sourceCodeRenderers,
    threadLists,
  } = usePluginSlots();
  const { accessState } = useLocalHostDaemonAccess();
  const cliCommandSupported = useCliCommandStatus().data?.supported ?? false;
  const performanceDiagnosticsAvailable =
    useSystemConfig().data?.performanceDiagnosticsAvailable ?? false;
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);
  const [rewritesLocalhostLinks] = useState(
    () =>
      localhostLinkRewriteDescription(
        typeof window === "undefined" ? undefined : window.location.hostname,
      ) !== null,
  );
  const hasFileOpeners = fileOpeners.some(
    (opener) => opener.extensions.length > 0,
  );
  const hasDiffRenderers = diffRenderers.length > 0;
  const hasSourceCodeRenderers = sourceCodeRenderers.length > 0;
  const hasThreadLists = threadLists.length > 0;
  const hasSidebarNavigations = experimentalSidebarNavigations.length > 0;
  const hasFilePreferences = accessState !== "unavailable";

  return useMemo(() => {
    const conditions: [SettingsSearchCondition, boolean][] = [
      ["cliCommand", cliCommandSupported],
      ["desktopBrowser", desktopBrowserAvailable],
      ["diffRenderers", hasDiffRenderers],
      ["fileOpeners", hasFileOpeners],
      ["filePreferences", hasFilePreferences],
      ["localhostLinkRewrite", rewritesLocalhostLinks],
      ["performanceDiagnostics", performanceDiagnosticsAvailable],
      ["sidebarNavigations", hasSidebarNavigations],
      ["sourceCodeRenderers", hasSourceCodeRenderers],
      ["threadLists", hasThreadLists],
    ];
    return new Set(
      conditions.flatMap(([condition, met]) => (met ? [condition] : [])),
    );
  }, [
    cliCommandSupported,
    desktopBrowserAvailable,
    hasDiffRenderers,
    hasFileOpeners,
    hasFilePreferences,
    hasSidebarNavigations,
    hasSourceCodeRenderers,
    hasThreadLists,
    performanceDiagnosticsAvailable,
    rewritesLocalhostLinks,
  ]);
}
