import { useMemo, useState } from "react";
import {
  useCliCommandStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { localhostLinkRewriteDescription } from "@/lib/localhost-link-rewrite-description";
import {
  hasPluginChoices as hasAnyPluginChoice,
  usePluginChoices,
} from "./PluginChoicesSection";
import type { SettingsSearchCondition } from "./settings-search";

export function useSettingsSearchConditions(): ReadonlySet<SettingsSearchCondition> {
  const pluginChoices = usePluginChoices();
  const choiceLabels = new Set(
    pluginChoices.slots.map((choice) => choice.label),
  );
  const { accessState } = useLocalHostDaemonAccess();
  const cliCommandSupported = useCliCommandStatus().data?.supported ?? false;
  const systemConfig = useSystemConfig().data;
  const performanceDiagnosticsAvailable =
    systemConfig?.performanceDiagnosticsAvailable ?? false;
  const pluginUpdatesEnabled = systemConfig?.experiments.pluginUpdates ?? false;
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);
  const [rewritesLocalhostLinks] = useState(
    () =>
      localhostLinkRewriteDescription(
        typeof window === "undefined" ? undefined : window.location.hostname,
      ) !== null,
  );
  const hasPluginChoices = hasAnyPluginChoice(pluginChoices);
  const hasComposers = choiceLabels.has("Composer");
  const hasDiffRenderers = choiceLabels.has("Diffs");
  const hasSourceCodeRenderers = choiceLabels.has("Source code");
  const hasThreadLists = choiceLabels.has("Sidebar thread list");
  const hasSidebarNavigations = choiceLabels.has("Navigation");
  const hasThreadHeaderTitles = choiceLabels.has("Thread header title");
  const hasFilePreferences = accessState !== "unavailable";

  return useMemo(() => {
    const conditions: [SettingsSearchCondition, boolean][] = [
      ["cliCommand", cliCommandSupported],
      ["composers", hasComposers],
      ["desktopBrowser", desktopBrowserAvailable],
      ["diffRenderers", hasDiffRenderers],
      ["filePreferences", hasFilePreferences],
      ["localhostLinkRewrite", rewritesLocalhostLinks],
      ["performanceDiagnostics", performanceDiagnosticsAvailable],
      ["pluginChoices", hasPluginChoices],
      ["pluginUpdates", pluginUpdatesEnabled],
      ["sidebarNavigations", hasSidebarNavigations],
      ["sourceCodeRenderers", hasSourceCodeRenderers],
      ["threadHeaderTitles", hasThreadHeaderTitles],
      ["threadLists", hasThreadLists],
    ];
    return new Set(
      conditions.flatMap(([condition, met]) => (met ? [condition] : [])),
    );
  }, [
    cliCommandSupported,
    desktopBrowserAvailable,
    hasComposers,
    hasDiffRenderers,
    hasFilePreferences,
    hasPluginChoices,
    hasSidebarNavigations,
    hasSourceCodeRenderers,
    hasThreadHeaderTitles,
    hasThreadLists,
    performanceDiagnosticsAvailable,
    pluginUpdatesEnabled,
    rewritesLocalhostLinks,
  ]);
}
