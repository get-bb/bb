import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";
import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { useEffect, useRef, type ReactNode } from "react";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import {
  takeOnboardingWorkEntry,
  type OnboardingWorkContext,
} from "./onboarding-work-context";

export type NewThreadBlockerReason = Extract<
  RecordTelemetryEventRequest,
  { name: "new_thread_blocker" }
>["properties"]["reason"];

export type NewThreadReadiness =
  | { status: "ready" }
  | { status: "pending" | "empty"; message: string }
  | { status: "blocked"; reason: NewThreadBlockerReason; message: string };

interface Presentation {
  viewers: Set<object>;
  blockers: Set<NewThreadBlockerReason>;
  context: OnboardingWorkContext;
}

const presentations = new Map<string, Presentation>();

interface WorkSurfaceObservationProps {
  children: ReactNode;
  identity: string;
  hasDraft: boolean;
  readiness: NewThreadReadiness;
}

function isVisible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

export function WorkSurfaceObservation({
  children,
  identity,
  hasDraft,
  readiness,
}: WorkSurfaceObservationProps) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ hasDraft, readiness });
  latest.current = { hasDraft, readiness };
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    const wrapper = container.current;
    if (!wrapper) return;
    const key = identity;
    const viewer = {};
    let target: HTMLElement | null = null;
    let joined = false;
    const leave = () => {
      if (!joined) return;
      joined = false;
      const presentation = presentations.get(key);
      presentation?.viewers.delete(viewer);
      queueMicrotask(() => {
        if (
          presentation?.viewers.size === 0 &&
          presentations.get(key) === presentation
        ) {
          presentations.delete(key);
        }
      });
    };
    const update = () => {
      if (!isDocumentVisible()) return;
      const element = wrapper.querySelector<HTMLElement>("[data-app-composer]");
      if (element !== target) {
        if (target) intersection?.unobserve(target);
        target = element;
        if (target) intersection?.observe(target);
      }
      if (!element || !isVisible(element)) {
        leave();
        return;
      }
      let presentation = presentations.get(key);
      if (!presentation) {
        presentation = {
          viewers: new Set(),
          blockers: new Set(),
          context: takeOnboardingWorkEntry(),
        };
        presentations.set(key, presentation);
        recordTelemetryEvent({
          name: "onboarding_work_surface",
          properties: {
            surface: "first_task",
            action: "displayed",
            entry: presentation.context.entry,
          },
        });
      }
      joined = true;
      presentation.viewers.add(viewer);
      if (!latest.current.hasDraft) return;
      const state = latest.current.readiness;
      if (state.status === "blocked") {
        if (presentation.blockers.has(state.reason)) return;
        presentation.blockers.add(state.reason);
        recordTelemetryEvent({
          name: "new_thread_blocker",
          properties: {
            state: "shown",
            reason: state.reason,
            source: presentation.context.source,
          },
        });
      } else if (state.status === "ready") {
        for (const reason of presentation.blockers) {
          recordTelemetryEvent({
            name: "new_thread_blocker",
            properties: {
              state: "cleared",
              reason,
              source: presentation.context.source,
            },
          });
        }
        presentation.blockers.clear();
      }
    };
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(update);
    const mutation = new MutationObserver(update);
    mutation.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    let ancestor = wrapper.parentElement;
    while (ancestor) {
      mutation.observe(ancestor, {
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden", "inert", "class", "style"],
      });
      ancestor = ancestor.parentElement;
    }
    const unsubscribeVisibility = subscribeToDocumentVisibility(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    refresh.current = update;
    update();
    return () => {
      refresh.current = null;
      leave();
      intersection?.disconnect();
      mutation.disconnect();
      unsubscribeVisibility();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [identity]);

  useEffect(() => refresh.current?.());

  return (
    <div ref={container} className="contents">
      {children}
    </div>
  );
}
