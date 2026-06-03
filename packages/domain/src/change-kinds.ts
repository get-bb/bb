import { z } from "zod";
import {
  threadEventTypeSchema,
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

export const APP_CHANGE_KINDS = ["apps-changed"] as const;
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

export interface ThreadChangedMessage {
  type: "changed";
  entity: "thread";
  id?: string;
  metadata?: ThreadChangeMetadata;
  changes: ThreadChangeKind[];
}

export interface ThreadChangeMetadata {
  eventTypes?: readonly ThreadEventType[];
  hasPendingInteraction?: boolean;
  projectId?: string;
}

export const threadChangeMetadataSchema = z
  .object({
    eventTypes: z.array(threadEventTypeSchema).optional(),
    hasPendingInteraction: z.boolean().optional(),
    projectId: z.string().optional(),
  })
  .strict();

export interface ProjectChangedMessage {
  type: "changed";
  entity: "project";
  id?: string;
  changes: ProjectChangeKind[];
}

export interface EnvironmentChangedMessage {
  type: "changed";
  entity: "environment";
  id?: string;
  changes: EnvironmentChangeKind[];
}

export interface HostChangedMessage {
  type: "changed";
  entity: "host";
  id?: string;
  changes: HostChangeKind[];
}

export interface SystemChangedMessage {
  type: "changed";
  entity: "system";
  changes: SystemChangeKind[];
}

export interface AppChangedMessage {
  type: "changed";
  entity: "app";
  id?: string;
  changes: AppChangeKind[];
}

export const threadChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("thread"),
    id: z.string().optional(),
    metadata: threadChangeMetadataSchema.optional(),
    changes: z.array(threadChangeKindSchema),
  })
  .strict();

export const projectChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("project"),
    id: z.string().optional(),
    changes: z.array(projectChangeKindSchema),
  })
  .strict();

export const environmentChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("environment"),
    id: z.string().optional(),
    changes: z.array(environmentChangeKindSchema),
  })
  .strict();

export const hostChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("host"),
    id: z.string().optional(),
    changes: z.array(hostChangeKindSchema),
  })
  .strict();

export const systemChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("system"),
    changes: z.array(systemChangeKindSchema),
  })
  .strict();

export const appChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("app"),
    id: z.string().optional(),
    changes: z.array(appChangeKindSchema),
  })
  .strict();

export const changedMessageSchema = z.discriminatedUnion("entity", [
  threadChangedMessageSchema,
  projectChangedMessageSchema,
  environmentChangedMessageSchema,
  hostChangedMessageSchema,
  systemChangedMessageSchema,
  appChangedMessageSchema,
]);

export type ChangedMessage =
  | ThreadChangedMessage
  | ProjectChangedMessage
  | EnvironmentChangedMessage
  | HostChangedMessage
  | SystemChangedMessage
  | AppChangedMessage;
