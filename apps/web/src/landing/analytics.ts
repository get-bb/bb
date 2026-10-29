import { useRouterState } from "@tanstack/react-router";
import type { PostHog } from "posthog-js";
import { useEffect } from "react";
import { withoutAdvertisingIds } from "./analytics-privacy";
import type { DownloadIntent } from "./download-intent";
import type { CtaPlacement } from "./site";

type LandingEvent =
  | {
      name: "landing_github_clicked";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "landing_discord_clicked";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "landing_x_clicked";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "landing_cli_command_copied";
      properties: { placement: CtaPlacement; command: string };
    }
  | {
      name: "landing_send_to_computer_clicked";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "guide_prompt_copied";
      properties: {
        guide: string;
        placement: "hero" | "handoff" | "step";
      };
    }
  | {
      name: "landing_email_subscribed";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "marketplace_page_viewed";
      properties: {
        category?: string;
        sort: "featured" | "recently-added" | "most-installed";
        author?: string;
      };
    }
  | {
      name: "marketplace_plugin_detail_viewed";
      properties: { plugin_id: string };
    }
  | {
      name: "marketplace_install_command_copied";
      properties: { plugin_id: string };
    };

let client: PostHog | null = null;
let loading = false;
const marketingPaths = new Set<string>();
let lastPageviewUrl: string | null = null;
const pendingEvents: { event: LandingEvent; url: string }[] = [];

export function initAnalytics(): void {
  if (typeof window === "undefined") return;
  marketingPaths.add(window.location.pathname);
  trackMarketingPageview();
  if (loading) {
    return;
  }
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    return;
  }
  loading = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      if (!marketingPaths.has(window.location.pathname)) {
        loading = false;
        pendingEvents.length = 0;
        return;
      }
      posthog.init(key, {
        api_host:
          import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        before_send: (event) => {
          if (!event || !marketingPaths.has(window.location.pathname))
            return null;
          if (
            event &&
            "globalPrivacyControl" in navigator &&
            navigator.globalPrivacyControl === true
          ) {
            event.properties = withoutAdvertisingIds(event.properties);
          }
          return event;
        },
      });
      client = posthog;
      trackMarketingPageview();
      for (const pending of pendingEvents.splice(0)) {
        if (pending.url === window.location.href) {
          client.capture(pending.event.name, pending.event.properties);
        }
      }
    })
    .catch(() => {
      pendingEvents.length = 0;
    });
}

export function useInitAnalytics(): void {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  useEffect(() => {
    initAnalytics();
  }, [pathname]);
}

export function trackMarketingPageview(): void {
  if (!marketingPaths.has(window.location.pathname)) {
    lastPageviewUrl = null;
    pendingEvents.length = 0;
    return;
  }
  const pageUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  if (!client || lastPageviewUrl === pageUrl) return;
  lastPageviewUrl = pageUrl;
  try {
    client.capture("$pageview", { $current_url: window.location.href });
  } catch {
    return;
  }
}

export function trackLandingEvent(event: LandingEvent): void {
  if (client) {
    client.capture(event.name, event.properties);
  } else if (loading) {
    pendingEvents.push({ event, url: window.location.href });
  }
}

export function trackDownloadIntent(properties: DownloadIntent): void {
  if (!marketingPaths.has(window.location.pathname)) return;
  try {
    client?.capture("landing_download_intent", properties, {
      send_instantly: true,
      transport: "sendBeacon",
    });
  } catch {
    return;
  }
}
