import { createContext, useCallback, useContext } from "react";
import { z } from "zod";
import { jsonValueSchema } from "@bb/domain";
import { useLatestRef } from "@/hooks/useLatestRef";
import {
  getThreadFixedTabOwnerId,
  type AppPanelController,
} from "@/lib/app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "@/lib/app-navigation-host";
import type { PluginTabSlot } from "@/lib/plugin-slots";
import {
  isPlainPrimaryClick,
  type UrlAnchorClickEvent,
} from "@/lib/url-open-routing";

export type PluginThreadActionTabSlot = Extract<
  PluginTabSlot,
  { context: { kind: "thread" }; availability: "action" }
>;

export type OpenClaimedUrl = (
  href: string,
  callerPluginId: string | null,
) => boolean;

export const PluginUrlClaimContext = createContext<OpenClaimedUrl | null>(null);

const claimedOpenOptionsSchema = z.object({
  title: z.string().optional(),
  params: jsonValueSchema.optional(),
});

type ClaimedOpenOptions = z.infer<typeof claimedOpenOptionsSchema>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWebUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

function readClaimedOpenOptions(value: unknown): ClaimedOpenOptions | null {
  if (value === null || value === undefined) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("must return panel open options or null");
  }
  return claimedOpenOptionsSchema.parse(value);
}

function claimUrlForThreadPanel(
  tabs: readonly PluginThreadActionTabSlot[],
  href: string,
  callerPluginId: string | null,
): AppTabOpenIntent | null {
  const url = parseWebUrl(href);
  if (url === null) return null;
  for (const tab of tabs) {
    if (
      tab.pluginId === callerPluginId ||
      tab.experimental_claimUrl === undefined
    ) {
      continue;
    }
    let options: ClaimedOpenOptions | null;
    try {
      options = readClaimedOpenOptions(tab.experimental_claimUrl(new URL(url)));
    } catch (error) {
      console.warn(
        `[plugin:${tab.pluginId}] experimental_tab "${tab.id}" experimental_claimUrl failed: ${describeError(error)}`,
      );
      continue;
    }
    if (options !== null) {
      return {
        tab: { ownerId: getThreadFixedTabOwnerId(tab.pluginId), tabId: tab.id },
        availability: "action",
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.params === undefined ? {} : { params: options.params }),
      };
    }
  }
  return null;
}

export function useOpenClaimedUrl(
  panel: AppPanelController,
  tabs: readonly PluginThreadActionTabSlot[],
): OpenClaimedUrl {
  const latestRef = useLatestRef({ panel, tabs });
  return useCallback<OpenClaimedUrl>(
    (href, callerPluginId) => {
      const latest = latestRef.current;
      const intent = claimUrlForThreadPanel(latest.tabs, href, callerPluginId);
      return intent !== null && latest.panel.openTab(intent);
    },
    [latestRef],
  );
}

export function useOpenClaimedUrlOnClick(): (
  event: UrlAnchorClickEvent,
  href: string,
) => boolean {
  const openClaimedUrl = useContext(PluginUrlClaimContext);
  return useCallback(
    (event, href) => {
      if (
        openClaimedUrl === null ||
        !isPlainPrimaryClick(event) ||
        !openClaimedUrl(href, null)
      ) {
        return false;
      }
      event.preventDefault();
      return true;
    },
    [openClaimedUrl],
  );
}
