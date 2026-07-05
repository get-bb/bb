import type { PostHog } from "posthog-js";
import type { CtaPlacement } from "./site";

/**
 * PostHog wiring for the landing page.
 *
 * Autocapture is off; the page emits only the explicit events below. UTM
 * parameters and the referrer are captured automatically by posthog-js on
 * `$pageview` and persisted as initial person properties, which is what links
 * ad campaigns to the download/install funnel.
 *
 * posthog-js is loaded lazily so it stays out of the critical-path bundle of
 * the ad landing page. Events fired before it finishes loading are queued and
 * flushed on init. Everything is a no-op unless VITE_POSTHOG_KEY is set at
 * build time, so local dev and forks ship with analytics disabled by default.
 */

export type LandingEvent =
  | {
      name: "landing_github_clicked";
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

/**
 * Load and initialize PostHog in the browser. Safe to call repeatedly; does
 * nothing during prerendering or when no key is configured.
 */
export function initAnalytics(): void {
  if (loading || typeof window === "undefined") {
    return;
  }
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    return;
  }
  loading = true;
  // Lazy import keeps posthog-js out of the landing page's main bundle.
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host:
        import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
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
