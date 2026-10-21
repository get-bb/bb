import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ownNotificationLevelSchema,
  threadNotificationInputsSchema,
} from "./preferences.js";

export const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 512;
export const DEVICE_LABEL_MAX_LENGTH = 120;

export const pushPlatformSchema = z.enum(["ios", "android"]);

export const pushSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    expoPushToken: z.string().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    deviceLabel: z.string().min(1).max(DEVICE_LABEL_MAX_LENGTH),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();

export const pushSubscriptionSummarySchema = pushSubscriptionSchema
  .omit({ expoPushToken: true })
  .extend({ tokenSuffix: z.string().min(1).max(6) })
  .strict();

export const addPushSubscriptionInputSchema = z
  .object({
    expoPushToken: z.string().trim().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    deviceLabel: z.string().trim().min(1).max(DEVICE_LABEL_MAX_LENGTH),
  })
  .strict();

export const removePushSubscriptionInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();

export const clientChannelSchema = z.enum(["web", "desktop"]);
export const CLIENT_NOTIFICATION_CHANNEL = "notification";
export const clientNotificationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    body: z.string(),
    threadId: z.string().nullable(),
    channels: z.array(clientChannelSchema),
  })
  .strict();
export type ClientNotification = z.infer<typeof clientNotificationSchema>;

export const THREAD_NOTIFICATIONS_LIST_MAX_IDS = 200;

const emptyInputSchema = z.object({}).strict();
export const listPushSubscriptionsOutputSchema = z
  .object({ subscriptions: z.array(pushSubscriptionSummarySchema) })
  .strict();

export const notificationsHintStateSchema = z
  .object({
    dismissCount: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    snoozedUntil: z.number().int().nonnegative().nullable(),
    accepted: z.boolean(),
    suggestion: z
      .object({ id: z.string().uuid(), shown: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict();
export type NotificationsHintState = z.infer<
  typeof notificationsHintStateSchema
>;

export const notificationsHintEligibilitySchema = z
  .object({
    suggestion: z.object({ id: z.string().uuid() }).strict().nullable(),
    nextCheckAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type NotificationsHintEligibility = z.infer<
  typeof notificationsHintEligibilitySchema
>;

const hintActionInputSchema = z.object({ id: z.string().uuid() }).strict();
export const NOTIFICATIONS_HINT_TAG = "notification-hint";

export const pushNotificationsRpcContract = defineRpcContract({
  "notificationsHint.eligibility": {
    input: z
      .object({ threadId: z.string().min(1), channel: clientChannelSchema })
      .strict(),
    output: notificationsHintEligibilitySchema,
    tags: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notificationsHint.state": {
    input: emptyInputSchema,
    output: notificationsHintStateSchema,
    tags: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notificationsHint.reset": {
    input: emptyInputSchema,
    output: notificationsHintStateSchema,
    invalidates: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notificationsHint.shown": {
    input: hintActionInputSchema,
    output: notificationsHintStateSchema,
    invalidates: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notificationsHint.accept": {
    input: hintActionInputSchema,
    output: notificationsHintStateSchema,
    invalidates: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notificationsHint.dismiss": {
    input: hintActionInputSchema,
    output: notificationsHintStateSchema,
    invalidates: () => [NOTIFICATIONS_HINT_TAG],
  },
  "notifications.test": {
    input: z.object({ channel: clientChannelSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "pushSubscriptions.list": {
    input: emptyInputSchema,
    output: listPushSubscriptionsOutputSchema,
  },
  "pushSubscriptions.add": {
    input: addPushSubscriptionInputSchema,
    output: z.object({ id: z.string().min(1), created: z.boolean() }).strict(),
  },
  "pushSubscriptions.remove": {
    input: removePushSubscriptionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "threadNotifications.list": {
    input: z
      .object({
        threadIds: z
          .array(z.string().min(1))
          .min(1)
          .max(THREAD_NOTIFICATIONS_LIST_MAX_IDS),
      })
      .strict(),
    output: z
      .object({
        threads: z.record(z.string(), threadNotificationInputsSchema),
      })
      .strict(),
  },
  "threadNotifications.keyed": {
    input: z
      .object({
        keys: z
          .array(z.string().min(1))
          .min(1)
          .max(THREAD_NOTIFICATIONS_LIST_MAX_IDS),
      })
      .strict(),
    output: z.record(z.string(), threadNotificationInputsSchema),
    keyTags: (key) => [`thread:${key}`],
  },
  "threadNotifications.set": {
    invalidates: ({ threadId }) => [`thread:${threadId}`],
    input: z
      .object({
        threadId: z.string().min(1),
        level: ownNotificationLevelSchema,
      })
      .strict(),
    output: threadNotificationInputsSchema,
  },
});

export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type PushSubscriptionSummary = z.infer<
  typeof pushSubscriptionSummarySchema
>;
export type AddPushSubscriptionInput = z.infer<
  typeof addPushSubscriptionInputSchema
>;
