/**
 * Ingest validation for provider extension payloads.
 *
 * Extension kinds (`"<pluginId>/<name>"`) are opaque JSON on the wire: the
 * daemon's assembler copies the bridge's payload onto the canonical
 * `extension` item or `thread/extensionState/updated` event without reading
 * it. The plugin that owns the kind declared a Standard Schema for it
 * (`experimental_extensionKinds` on its provider declaration), and this is
 * the one place that schema is enforced — before the event is persisted, so
 * nothing a client renders or a plugin reads back came from a payload its
 * plugin did not vouch for.
 *
 * A payload that fails — undeclared kind, schema miss, validator error, or
 * oversized — is not dropped silently: the event is replaced by a
 * `provider/unhandled` carrying the original kind and payload, the same
 * visible fate as any provider traffic core cannot classify (guardrail G11
 * counts it). The batch keeps its shape, so sequencing and the accepted-event
 * response are unaffected.
 */
import { getThread } from "@bb/db";
import type { ExtensionKind, JsonValue, ThreadEvent } from "@bb/domain";
import { parseExtensionKind } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import type {
  StandardSchemaV1,
  StandardSchemaV1Issue,
  StandardSchemaV1Result,
} from "@get-bb/plugin-sdk";
import type { AppDeps } from "../types.js";

/**
 * Extension payloads are timeline rows, not transcripts. The cap is generous
 * for structured state (a goal, a permission profile, a widget model) and far
 * below anything that would bloat the events table or the boot payload.
 */
export const EXTENSION_PAYLOAD_MAX_BYTES = 64 * 1024;

export type ExtensionPayloadValidationDeps = Pick<
  AppDeps,
  "db" | "logger" | "providerRegistry"
>;

/** One extension payload in an event, plus what its replacement row needs. */
interface ExtensionPayloadSite {
  surface: "item" | "state";
  kind: ExtensionKind;
  payload: JsonValue;
  eventType: ThreadEvent["type"];
  threadId: string;
  providerThreadId: string;
  scope: ThreadEvent["scope"];
  parentToolCallId: string | undefined;
}

function extensionSiteOf(event: ThreadEvent): ExtensionPayloadSite | null {
  switch (event.type) {
    case "item/started":
    case "item/completed":
      return event.item.type === "extension"
        ? {
            surface: "item",
            kind: event.item.kind,
            payload: event.item.payload,
            eventType: event.type,
            threadId: event.threadId,
            providerThreadId: event.providerThreadId,
            scope: event.scope,
            parentToolCallId: event.item.parentToolCallId,
          }
        : null;
    case "thread/extensionState/updated":
      return {
        surface: "state",
        kind: event.kind,
        payload: event.payload,
        eventType: event.type,
        threadId: event.threadId,
        providerThreadId: event.providerThreadId,
        scope: event.scope,
        parentToolCallId: undefined,
      };
    default:
      return null;
  }
}

type ValidationOutcome = { ok: true } | { ok: false; reason: string };

/** A Standard Schema issue path is a bare key or a list of keys/`{ key }`s. */
function issuePathSegments(path: StandardSchemaV1Issue["path"]): string[] {
  if (path === undefined) {
    return [];
  }
  if (!Array.isArray(path)) {
    return [String(path)];
  }
  return path.map((segment) =>
    typeof segment === "object" && segment !== null
      ? String(segment.key)
      : String(segment),
  );
}

async function validateAgainstSchema(
  schema: StandardSchemaV1,
  payload: JsonValue,
): Promise<ValidationOutcome> {
  let result: StandardSchemaV1Result<unknown>;
  try {
    result = await schema["~standard"].validate(payload);
  } catch (error) {
    return {
      ok: false,
      reason: `validator threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (result.issues !== undefined) {
    return {
      ok: false,
      reason: result.issues
        .map((issue) => {
          const path = issuePathSegments(issue.path).join(".");
          return path === "" ? issue.message : `${path}: ${issue.message}`;
        })
        .join("; "),
    };
  }
  return { ok: true };
}

async function validateSite(
  deps: ExtensionPayloadValidationDeps,
  site: ExtensionPayloadSite,
): Promise<ValidationOutcome> {
  const declared = deps.providerRegistry.getExtensionKindSchemas(site.kind);
  const schema = declared?.[site.surface];
  if (schema === undefined) {
    const { pluginId, name } = parseExtensionKind(site.kind);
    return {
      ok: false,
      reason:
        declared === null
          ? `plugin "${pluginId}" declares no extension kind "${name}"`
          : `plugin "${pluginId}" declares extension kind "${name}" with no ${site.surface} schema`,
    };
  }
  const bytes = Buffer.byteLength(JSON.stringify(site.payload));
  if (bytes > EXTENSION_PAYLOAD_MAX_BYTES) {
    return {
      ok: false,
      reason: `payload is ${bytes} bytes; the limit is ${EXTENSION_PAYLOAD_MAX_BYTES}`,
    };
  }
  return validateAgainstSchema(schema, site.payload);
}

/**
 * The rejected event's visible replacement. The thread's provider id is what
 * `provider/unhandled` is counted under; the kind and payload ride the raw
 * event so the row is diagnosable. Scope and parent are kept so the row sits
 * where the original would have.
 */
function toUnhandledEvent(
  deps: ExtensionPayloadValidationDeps,
  site: ExtensionPayloadSite,
  reason: string,
): ThreadEvent {
  const providerId =
    getThread(deps.db, site.threadId)?.providerId ??
    parseExtensionKind(site.kind).pluginId;
  return {
    type: "provider/unhandled",
    threadId: site.threadId,
    providerThreadId: site.providerThreadId,
    providerId,
    rawType: `extension/${site.surface}:${site.kind}`,
    rawEvent: {
      jsonrpc: "2.0",
      method: site.eventType,
      params: { kind: site.kind, payload: site.payload, reason },
    },
    scope: site.scope,
    ...(site.parentToolCallId === undefined
      ? {}
      : { parentToolCallId: site.parentToolCallId }),
  };
}

/**
 * Validate every extension payload in a batch. Returns envelopes in the same
 * order and count; a rejected event is replaced by its `provider/unhandled`.
 */
export async function validateExtensionPayloads(
  deps: ExtensionPayloadValidationDeps,
  envelopes: readonly HostDaemonEventEnvelope[],
): Promise<HostDaemonEventEnvelope[]> {
  return Promise.all(
    envelopes.map(async (envelope) => {
      const site = extensionSiteOf(envelope.event);
      if (site === null) {
        return envelope;
      }
      const outcome = await validateSite(deps, site);
      if (outcome.ok) {
        return envelope;
      }
      deps.logger.warn(
        {
          threadId: envelope.threadId,
          eventType: envelope.event.type,
          extensionKind: site.kind,
          surface: site.surface,
          reason: outcome.reason,
        },
        "Rejected provider extension payload at ingest",
      );
      return {
        ...envelope,
        event: toUnhandledEvent(deps, site, outcome.reason),
      };
    }),
  );
}
