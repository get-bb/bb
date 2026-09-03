import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_EXPO_PUSH_URL =
  "https://exp.host/--/api/v2/push/send";
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
    expoPushToken: z
      .string()
      .trim()
      .min(1)
      .max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    deviceLabel: z.string().trim().min(1).max(DEVICE_LABEL_MAX_LENGTH),
  })
  .strict();

export const removePushSubscriptionInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();

const emptyInputSchema = z.object({}).strict();
export const listPushSubscriptionsOutputSchema = z
  .object({ subscriptions: z.array(pushSubscriptionSummarySchema) })
  .strict();

export const pushNotificationsRpcContract = defineRpcContract({
  "pushSubscriptions.list": {
    input: emptyInputSchema,
    output: listPushSubscriptionsOutputSchema,
  },
  "pushSubscriptions.add": {
    input: addPushSubscriptionInputSchema,
    output: z
      .object({ id: z.string().min(1), created: z.boolean() })
      .strict(),
  },
  "pushSubscriptions.remove": {
    input: removePushSubscriptionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type PushSubscriptionSummary = z.infer<
  typeof pushSubscriptionSummarySchema
>;
export type AddPushSubscriptionInput = z.infer<
  typeof addPushSubscriptionInputSchema
>;
