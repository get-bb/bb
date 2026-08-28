import type { PostHog } from "posthog-js";
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
      name: "landing_email_subscribed";
      properties: { placement: CtaPlacement };
    };

let client: PostHog | null = null;
let loading = false;
const pendingEvents: LandingEvent[] = [];

export function initAnalytics(): void {
  if (loading || typeof window === "undefined") {
    return;
  }
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    return;
  }
  loading = true;
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
    });
    client = posthog;
    for (const event of pendingEvents.splice(0)) {
      client.capture(event.name, event.properties);
    }
  });
}

export function trackLandingEvent(event: LandingEvent): void {
  if (client) {
    client.capture(event.name, event.properties);
  } else if (loading) {
    pendingEvents.push(event);
  }
}
