import type { PostHog } from "posthog-js";
import { useEffect } from "react";
import {
  TOUCH_QUERY,
  type ExperimentBootstrap,
  type ExperimentDevices,
  type ExperimentKey,
} from "../experiments/flags";
import type { ArrivalSource } from "./arrival-source";
import type { CtaPlacement } from "./site";

type LandingEvent =
  | {
      name: "landing_github_clicked";
      properties: { placement: CtaPlacement };
    }
  | {
      name: "landing_marketplace_clicked";
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
      name: "landing_section_viewed";
      properties: { section: string };
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
      properties: {
        plugin_id: string;
        entry_id: string;
        arrival_source: ArrivalSource;
      };
    }
  | {
      name: "marketplace_install_command_copied";
      properties: { plugin_id: string; entry_id: string };
    };

let client: PostHog | null = null;
let loading = false;
let serverDistinctId: string | null = null;
const pendingEvents: LandingEvent[] = [];
const pendingExposures: ExperimentKey[] = [];
const exposedKeys = new Set<ExperimentKey>();

export function initAnalytics(experiments?: ExperimentBootstrap): void {
  if (loading || typeof window === "undefined") {
    return;
  }
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    return;
  }
  loading = true;
  serverDistinctId = experiments?.distinctID ?? null;
  const internalUser =
    new URLSearchParams(window.location.search).get("bb_internal") === "1";
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      ...(experiments?.distinctID
        ? {
            bootstrap: {
              distinctID: experiments.distinctID,
              isIdentifiedID: false,
              featureFlags: experiments.preview
                ? {}
                : { ...experiments.featureFlags },
            },
          }
        : {}),
    });
    if (internalUser) {
      posthog.register({ internal_user: true });
    }
    client = posthog;
    for (const event of pendingEvents.splice(0)) {
      client.capture(event.name, event.properties);
    }
    for (const flag of pendingExposures.splice(0)) {
      client.getFeatureFlag(flag);
    }
  });
}

export function useInitAnalytics(experiments?: ExperimentBootstrap): void {
  useEffect(() => {
    initAnalytics(experiments);
  }, [experiments]);
}

export function exposeExperiment(
  key: ExperimentKey,
  devices: ExperimentDevices,
): void {
  if (exposedKeys.has(key) || typeof window === "undefined") {
    return;
  }
  if (devices !== "all") {
    const touch = window.matchMedia(TOUCH_QUERY).matches;
    if (touch !== (devices === "touch")) {
      return;
    }
  }
  exposedKeys.add(key);
  if (client) {
    client.getFeatureFlag(key);
  } else {
    pendingExposures.push(key);
  }
}

export type VisitIds = {
  distinctId: string;
  sessionId: string | null;
};

export function readVisitIds(): VisitIds | null {
  const distinctId = client ? client.get_distinct_id() : serverDistinctId;
  if (!distinctId) {
    return null;
  }
  return { distinctId, sessionId: client?.get_session_id() || null };
}

export function trackLandingEvent(event: LandingEvent): void {
  if (client) {
    client.capture(event.name, event.properties);
  } else if (loading) {
    pendingEvents.push(event);
  }
}
