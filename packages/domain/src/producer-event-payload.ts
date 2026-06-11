import { jsonValueSchema, type JsonValue } from "./json-value.js";
import { threadEventSchema, type ThreadEvent } from "./provider-event.js";
import { workflowRunEventSchema, type WorkflowRunEvent } from "./workflow-run.js";

export interface CanonicalizeProducerEventPayloadArgs {
  event: ThreadEvent;
  protocolVersion: number;
  threadId: string;
}

export interface CanonicalizeEventSpoolPayloadArgs {
  event: ThreadEvent;
  threadId: string;
}

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const canonicalValue: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const entryValue = value[key];
    if (entryValue !== undefined) {
      canonicalValue[key] = canonicalizeJsonValue(entryValue);
    }
  }
  return canonicalValue;
}

function parseJsonValue(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

function canonicalizeJsonString(value: string): string {
  return JSON.stringify(canonicalizeJsonValue(parseJsonValue(value)));
}

export function canonicalizeProducerEventPayload(
  args: CanonicalizeProducerEventPayloadArgs,
): string {
  const event = threadEventSchema.parse(args.event);
  const json = JSON.stringify({
    event,
    eventType: event.type,
    protocolVersion: args.protocolVersion,
    threadId: args.threadId,
  });
  return canonicalizeJsonString(json);
}

export function canonicalizeEventSpoolPayload(
  args: CanonicalizeEventSpoolPayloadArgs,
): string {
  const event = threadEventSchema.parse(args.event);
  const json = JSON.stringify({
    event,
    eventType: event.type,
    threadId: args.threadId,
  });
  return canonicalizeJsonString(json);
}

export interface CanonicalizeWorkflowRunEventPayloadArgs {
  event: WorkflowRunEvent;
  runId: string;
}

/**
 * The ONE canonical form for workflow run-event payload hashes, shared by the
 * daemon's workflow event spool and server ingestion. Deliberately
 * protocol-version-independent: baking the protocol version into the hash (as
 * `canonicalizeProducerEventPayload` does for thread events) invalidates
 * every in-flight spool hash on a protocol bump and forced a legacy-hash
 * migration there — do not repeat that here.
 */
export function canonicalizeWorkflowRunEventPayload(
  args: CanonicalizeWorkflowRunEventPayloadArgs,
): string {
  const event = workflowRunEventSchema.parse(args.event);
  const json = JSON.stringify({
    event,
    eventType: event.type,
    runId: args.runId,
  });
  return canonicalizeJsonString(json);
}
