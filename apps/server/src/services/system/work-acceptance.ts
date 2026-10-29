import type { ThreadCreateOrigin, ThreadTurnInitiator } from "@bb/domain";
import {
  unknownWorkSuggestionAttribution,
  type WorkSuggestionAttribution,
} from "@bb/server-contract";
import type { TelemetryService } from "./telemetry.js";

export type WorkInitiator =
  | "user"
  | "agent"
  | "system"
  | "plugin"
  | "automation"
  | "unknown";

export interface WorkTelemetryProperties {
  work_initiator: WorkInitiator;
  suggestion_origin: WorkSuggestionAttribution["origin"];
  suggestion_surface: WorkSuggestionAttribution["surface"];
  suggestion_template_key: WorkSuggestionAttribution["template_key"];
  suggestion_content_revision: WorkSuggestionAttribution["content_revision"];
  suggestion_edit_state: WorkSuggestionAttribution["edit_state"];
}

export type AcceptedWorkTelemetryEvent =
  | {
      name: "work_accepted";
      properties: WorkTelemetryProperties & { work_kind: "thread" | "message" };
    }
  | {
      name: "onboarding_suggestion";
      properties: {
        action: "send_accepted";
        surface: "first_task" | "continuation";
        origin: "curated" | "project_context" | "agent_context" | "mixed";
        target: "current_thread" | "new_thread";
        fallback_reason: "none";
        template_key: null;
        content_revision: "baseline";
        edit_state: "unchanged" | "edited" | "unknown";
      };
    };

export function resolveAcceptedWorkInitiator(args: {
  initiator: ThreadTurnInitiator;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
}): WorkInitiator {
  if (args.initiator === "agent" || args.initiator === "system")
    return args.initiator;
  if (args.originPluginId === "automations") return "automation";
  if (args.origin === "plugin" || args.originPluginId !== null) return "plugin";
  if (args.origin === "sdk") return "unknown";
  return args.initiator;
}

export function workTelemetryProperties(
  initiator: WorkInitiator,
  suggestion: WorkSuggestionAttribution,
): WorkTelemetryProperties {
  return {
    work_initiator: initiator,
    suggestion_origin: suggestion.origin,
    suggestion_surface: suggestion.surface,
    suggestion_template_key: suggestion.template_key,
    suggestion_content_revision: suggestion.content_revision,
    suggestion_edit_state: suggestion.edit_state,
  };
}

export function captureAcceptedWork(
  telemetry: TelemetryService,
  args: {
    kind: "thread" | "message";
    initiator: WorkInitiator;
    suggestion: WorkSuggestionAttribution;
  },
): void {
  telemetry.capture({
    name: "work_accepted",
    properties: {
      work_kind: args.kind,
      ...workTelemetryProperties(args.initiator, args.suggestion),
    },
  });
  const suggestion = args.suggestion;
  if (
    args.initiator !== "user" ||
    suggestion.origin === "none" ||
    suggestion.origin === "unknown" ||
    suggestion.surface === null ||
    suggestion.content_revision === null ||
    suggestion.edit_state === "not_applicable"
  )
    return;
  telemetry.capture({
    name: "onboarding_suggestion",
    properties: {
      action: "send_accepted",
      surface: suggestion.surface,
      origin: suggestion.origin,
      target: args.kind === "thread" ? "new_thread" : "current_thread",
      fallback_reason: "none",
      template_key: suggestion.template_key,
      content_revision: suggestion.content_revision,
      edit_state: suggestion.edit_state,
    },
  });
}

export function unknownWorkTelemetryProperties(): WorkTelemetryProperties {
  return workTelemetryProperties("unknown", unknownWorkSuggestionAttribution());
}
