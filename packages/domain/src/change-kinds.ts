import { z } from "zod";
import {
  threadEventTypeSchema,
  threadEventTypeValues,
  type ThreadEventType,
} from "./provider-event.js";

export const REALTIME_ENTITIES = [
  "thread",
  "project",
  "environment",
  "host",
  "system",
  "app",
] as const;
export type RealtimeEntity = (typeof REALTIME_ENTITIES)[number];
export const realtimeEntitySchema = z.enum(REALTIME_ENTITIES);

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "thread-deleted",
  "events-appended",
  "interactions-changed",
  "status-changed",
  "title-changed",
  "queue-changed",
  "archived-changed",
  "pin-state-changed",
  "parent-changed",
  "read-state-changed",
  "manager-assignment-changed",
  "order-changed",
  "terminals-changed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];

export const PROJECT_CHANGE_KINDS = [
  "project-created",
  "project-updated",
  "project-deleted",
  "project-sources-changed",
  "threads-changed",
  "project-order-changed",
  "automations-changed",
  "nudges-changed",
] as const;
export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number];

export const ENVIRONMENT_CHANGE_KINDS = [
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
  "work-status-changed",
  "git-refs-changed",
  "thread-storage-changed",
] as const;
export type EnvironmentChangeKind = (typeof ENVIRONMENT_CHANGE_KINDS)[number];

export const HOST_CHANGE_KINDS = [
  "host-connected",
  "host-disconnected",
] as const;
export type HostChangeKind = (typeof HOST_CHANGE_KINDS)[number];

export const SYSTEM_CHANGE_KINDS = ["config-changed", "apps-changed"] as const;
export type SystemChangeKind = (typeof SYSTEM_CHANGE_KINDS)[number];

/**
 * `apps-changed` is the list-level kind broadcast without an app id (some app
 * was installed, updated, or removed). App-scoped kinds like `content-changed`
 * always carry the application id and have dedicated producers.
 */
export const APP_CHANGE_KINDS = ["apps-changed", "content-changed"] as const;
export type AppChangeKind = (typeof APP_CHANGE_KINDS)[number];

export const threadChangeKindSchema = z.enum(THREAD_CHANGE_KINDS);
export const projectChangeKindSchema = z.enum(PROJECT_CHANGE_KINDS);
export const environmentChangeKindSchema = z.enum(ENVIRONMENT_CHANGE_KINDS);
export const hostChangeKindSchema = z.enum(HOST_CHANGE_KINDS);
export const systemChangeKindSchema = z.enum(SYSTEM_CHANGE_KINDS);
export const appChangeKindSchema = z.enum(APP_CHANGE_KINDS);

export const subscribeMessageSchema = z.object({
  type: z.literal("subscribe"),
  entity: realtimeEntitySchema,
  id: z.string().optional(),
});
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

export const unsubscribeMessageSchema = z.object({
  type: z.literal("unsubscribe"),
  entity: realtimeEntitySchema,
  id: z.string().optional(),
});
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const threadChangeMetadataSchema = z
  .object({
    eventTypes: z.array(threadEventTypeSchema).readonly().optional(),
    hasPendingInteraction: z.boolean().optional(),
    projectId: z.string().optional(),
  })
  .strict();
export type ThreadChangeMetadata = z.infer<typeof threadChangeMetadataSchema>;

/**
 * Strict changed-message schemas validate the server's OUTGOING broadcasts —
 * the producer is in-repo, so unknown fields or kinds there are bugs and must
 * fail loudly. Message types are derived from these schemas (z.infer) so the
 * contract cannot drift from the validators.
 *
 * Clients must NOT parse inbound traffic with these: a long-lived tab or an
 * older installed SDK talking to a newer server would drop entire messages
 * over an additive change. Inbound parsing uses the lenient schemas below.
 */
export const threadChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("thread"),
    id: z.string().optional(),
    metadata: threadChangeMetadataSchema.optional(),
    changes: z.array(threadChangeKindSchema).readonly(),
  })
  .strict();
export type ThreadChangedMessage = z.infer<typeof threadChangedMessageSchema>;

export const projectChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("project"),
    id: z.string().optional(),
    changes: z.array(projectChangeKindSchema).readonly(),
  })
  .strict();
export type ProjectChangedMessage = z.infer<
  typeof projectChangedMessageSchema
>;

export const environmentChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("environment"),
    id: z.string().optional(),
    changes: z.array(environmentChangeKindSchema).readonly(),
  })
  .strict();
export type EnvironmentChangedMessage = z.infer<
  typeof environmentChangedMessageSchema
>;

export const hostChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("host"),
    id: z.string().optional(),
    changes: z.array(hostChangeKindSchema).readonly(),
  })
  .strict();
export type HostChangedMessage = z.infer<typeof hostChangedMessageSchema>;

export const systemChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("system"),
    changes: z.array(systemChangeKindSchema).readonly(),
  })
  .strict();
export type SystemChangedMessage = z.infer<typeof systemChangedMessageSchema>;

/**
 * App changed messages carry an `id` only for app-scoped kinds: absence means
 * a list-level signal (`apps-changed` — some app was installed, updated, or
 * removed), presence means the change applies to that one application
 * (`content-changed` — its served `public/` files changed on disk).
 */
export const appChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("app"),
    id: z.string().optional(),
    changes: z.array(appChangeKindSchema).readonly(),
  })
  .strict();
export type AppChangedMessage = z.infer<typeof appChangedMessageSchema>;

export const changedMessageSchema = z.discriminatedUnion("entity", [
  threadChangedMessageSchema,
  projectChangedMessageSchema,
  environmentChangedMessageSchema,
  hostChangedMessageSchema,
  systemChangedMessageSchema,
  appChangedMessageSchema,
]);
export type ChangedMessage = z.infer<typeof changedMessageSchema>;

/**
 * Lenient changed-message schemas parse INBOUND broadcasts on clients (SDK
 * consumers and the web app). They tolerate version skew against a newer
 * server: unknown fields are stripped and unknown change kinds are filtered
 * out instead of rejecting the whole message, so a stale client keeps
 * receiving the kinds it understands. Their output remains assignable to the
 * strict message types — dispatch sites enforce that at compile time.
 */
function lenientKinds<TKind extends string>(kinds: readonly TKind[]) {
  const known: ReadonlySet<string> = new Set(kinds);
  return z
    .array(z.string())
    .transform((values) =>
      values.filter((value): value is TKind => known.has(value)),
    );
}

const knownThreadEventTypes: ReadonlySet<string> = new Set(
  threadEventTypeValues,
);

const threadChangeMetadataLenientSchema = z.object({
  eventTypes: z
    .array(z.string())
    .transform((values) =>
      values.filter((value): value is ThreadEventType =>
        knownThreadEventTypes.has(value),
      ),
    )
    .optional(),
  hasPendingInteraction: z.boolean().optional(),
  projectId: z.string().optional(),
});

const threadChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("thread"),
  id: z.string().optional(),
  metadata: threadChangeMetadataLenientSchema.optional(),
  changes: lenientKinds(THREAD_CHANGE_KINDS),
});

const projectChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("project"),
  id: z.string().optional(),
  changes: lenientKinds(PROJECT_CHANGE_KINDS),
});

const environmentChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("environment"),
  id: z.string().optional(),
  changes: lenientKinds(ENVIRONMENT_CHANGE_KINDS),
});

const hostChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("host"),
  id: z.string().optional(),
  changes: lenientKinds(HOST_CHANGE_KINDS),
});

const systemChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("system"),
  changes: lenientKinds(SYSTEM_CHANGE_KINDS),
});

const appChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("app"),
  id: z.string().optional(),
  changes: lenientKinds(APP_CHANGE_KINDS),
});

export const changedMessageLenientSchema = z.discriminatedUnion("entity", [
  threadChangedMessageLenientSchema,
  projectChangedMessageLenientSchema,
  environmentChangedMessageLenientSchema,
  hostChangedMessageLenientSchema,
  systemChangedMessageLenientSchema,
  appChangedMessageLenientSchema,
]);
