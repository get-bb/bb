import { useEffect, useRef } from "react";
import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";

type FirstUseProperties = Extract<
  RecordTelemetryEventRequest,
  { name: "new_thread_composer_shown" }
>["properties"];

export type NewThreadComposerBlocker = FirstUseProperties["blocker"];

export const NEW_THREAD_COMPOSER_SETTLE_TIMEOUT_MS = 10_000;

const reported = { shown: false, draftStarted: false };

export function resetNewThreadFirstUseTelemetryForTest(): void {
  reported.shown = false;
  reported.draftStarted = false;
}

interface FirstUseSnapshot {
  blocker: NewThreadComposerBlocker;
  providerId: string;
}

function firstUseProperties({
  blocker,
  providerId,
}: FirstUseSnapshot): FirstUseProperties {
  return providerId ? { blocker, resource_id: providerId } : { blocker };
}

function reportShown(snapshot: FirstUseSnapshot): void {
  if (reported.shown) return;
  reported.shown = true;
  recordTelemetryEvent({
    name: "new_thread_composer_shown",
    properties: firstUseProperties(snapshot),
  });
}

export function useNewThreadFirstUseTelemetry({
  enabled,
  blocker,
  providerId,
  hasDraft,
}: FirstUseSnapshot & { enabled: boolean; hasDraft: boolean }): void {
  const latest = useRef<FirstUseSnapshot>({ blocker, providerId });
  useEffect(() => {
    latest.current = { blocker, providerId };
  });
  useEffect(() => {
    if (!enabled || reported.shown) return;
    const timer = setTimeout(
      () => reportShown(latest.current),
      NEW_THREAD_COMPOSER_SETTLE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || blocker === "pending") return;
    reportShown({ blocker, providerId });
  }, [blocker, enabled, providerId]);
  const hadDraft = useRef(hasDraft);
  useEffect(() => {
    const draftAppeared = hasDraft && !hadDraft.current;
    hadDraft.current = hasDraft;
    if (!enabled || !draftAppeared || reported.draftStarted) return;
    reportShown(latest.current);
    reported.draftStarted = true;
    recordTelemetryEvent({
      name: "new_thread_draft_started",
      properties: firstUseProperties(latest.current),
    });
  }, [enabled, hasDraft]);
}
