import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  addPushSubscriptionInputSchema,
  CLIENT_NOTIFICATION_CHANNEL,
  clientChannelSchema,
  DEFAULT_EXPO_PUSH_URL,
  DEVICE_LABEL_MAX_LENGTH,
  EXPO_PUSH_TOKEN_MAX_LENGTH,
  pushNotificationsRpcContract,
  type ClientNotification,
  type PushSubscriptionSummary,
} from "./contract.js";
import {
  createPushSender,
  type CreatePushSenderArgs,
  type LastSendOutcome,
} from "./sender.js";
import { createPushSubscriptionStore } from "./subscriptions.js";

interface PushNotificationsPluginOptions {
  coalesceMs?: number;
  createId?: () => string;
  fetch?: CreatePushSenderArgs["fetch"];
  now?: () => number;
}

interface StatusView {
  enabled: true;
  subscriptionCount: number;
  mobileEnabled: boolean;
  webEnabled: boolean;
  desktopEnabled: boolean;
  relayUrl: string;
  lastSendOutcome: LastSendOutcome;
}

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

function formatSubscriptions(
  subscriptions: readonly PushSubscriptionSummary[],
): string {
  if (subscriptions.length === 0) return "No push devices registered";
  return [
    "ID\tDevice\tPlatform\tLast seen\tToken suffix",
    ...subscriptions.map((subscription) =>
      [
        subscription.id,
        subscription.deviceLabel,
        subscription.platform,
        new Date(subscription.lastSeenAt).toISOString(),
        subscription.tokenSuffix,
      ].join("\t"),
    ),
  ].join("\n");
}

function formatLastOutcome(outcome: LastSendOutcome): string {
  if (outcome.status === "never") return "Never";
  if (outcome.status === "sent") {
    return `Sent ${outcome.sentCount} at ${new Date(outcome.at).toISOString()}`;
  }
  return `Failed at ${new Date(outcome.at).toISOString()}: ${outcome.reason}`;
}

function formatStatus(status: StatusView): string {
  return [
    `Enabled: ${status.enabled}`,
    `Mobile: ${status.mobileEnabled}`,
    `Web: ${status.webEnabled}`,
    `Desktop: ${status.desktopEnabled}`,
    `Subscriptions: ${status.subscriptionCount}`,
    `Relay URL: ${status.relayUrl}`,
    `Last send: ${formatLastOutcome(status.lastSendOutcome)}`,
  ].join("\n");
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createPushNotificationsPlugin(
  options: PushNotificationsPluginOptions = {},
) {
  return async function pushNotificationsPlugin(
    bb: BbPluginApi,
  ): Promise<void> {
    const settings = bb.settings.define({
      mobileEnabled: {
        type: "boolean",
        label: "Mobile notifications",
        description:
          "Send push messages to your registered phones and tablets.",
        default: true,
      },
      webEnabled: {
        type: "boolean",
        label: "Web notifications",
        description:
          "Show system notifications while bb is open in a browser. Each browser needs notification permission.",
        default: true,
      },
      desktopEnabled: {
        type: "boolean",
        label: "Desktop notifications",
        description:
          "Show system notifications while the bb desktop app is running.",
        default: true,
      },
      expoPushUrl: {
        type: "string",
        label: "Expo push relay URL",
        description: "The Expo push relay endpoint used for mobile delivery.",
        default: DEFAULT_EXPO_PUSH_URL,
        experimental_schema: z.string().url(),
      },
    });
    const subscriptions = createPushSubscriptionStore(bb, {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createId === undefined ? {} : { createId: options.createId }),
    });
    const sender = createPushSender({
      bb,
      subscriptions,
      getDeliverySettings: () => settings.get(),
      getExpoPushUrl: async () => (await settings.get()).expoPushUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.coalesceMs === undefined
        ? {}
        : { coalesceMs: options.coalesceMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    async function status(): Promise<StatusView> {
      const [{ expoPushUrl, mobileEnabled, webEnabled, desktopEnabled }, rows] =
        await Promise.all([settings.get(), subscriptions.list()]);
      return {
        enabled: true,
        subscriptionCount: rows.length,
        mobileEnabled,
        webEnabled,
        desktopEnabled,
        relayUrl: expoPushUrl,
        lastSendOutcome: sender.getLastOutcome(),
      };
    }

    async function sendTest(channel: "web" | "desktop") {
      const config = await settings.get();
      if (!(channel === "web" ? config.webEnabled : config.desktopEnabled)) {
        throw new Error(`${channel} notifications are disabled`);
      }
      bb.realtime.publish(CLIENT_NOTIFICATION_CHANNEL, {
        id: randomUUID(),
        title: "bb notifications are working",
        body: "You’ll be notified when a thread needs your attention.",
        threadId: null,
        channels: [channel],
      } satisfies ClientNotification);
      return { ok: true as const };
    }

    bb.rpc.register(pushNotificationsRpcContract, {
      "notifications.test": ({ channel }) => sendTest(channel),
      "pushSubscriptions.list": async () => ({
        subscriptions: await subscriptions.listSummaries(),
      }),
      "pushSubscriptions.add": (input) => subscriptions.add(input),
      "pushSubscriptions.remove": async ({ id }) => {
        if (!(await subscriptions.remove(id))) {
          throw new Error(`Push subscription not found: ${id}`);
        }
        return { ok: true as const };
      },
    });

    bb.cli.register(
      defineCli({
        name: "push-notifications",
        summary: "Manage mobile, web, and desktop notifications",
        description:
          "Mobile devices receive Expo push messages; web and desktop clients receive system notifications while they are open.",
        commands: {
          test: cliCommand({
            summary:
              "Send a test to connected web or desktop clients with permission",
            positionals: [
              {
                name: "channel",
                description: "Client type to notify: web or desktop",
                required: true,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const channel = clientChannelSchema.safeParse(
                input.positionals.channel,
              );
              if (!channel.success) {
                throw new PluginCliError("Use web or desktop", {
                  code: "invalid_channel",
                  hint: "Mobile devices are tested from the phone itself; this command only reaches web and desktop clients.",
                });
              }
              try {
                await sendTest(channel.data);
              } catch (error) {
                throw new PluginCliError(
                  error instanceof Error ? error.message : String(error),
                  {
                    code: "channel_disabled",
                    hint: `Turn it on with \`bb plugin config push-notifications set ${channel.data}Enabled true\`.`,
                  },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ok: true, channel: channel.data })
                  : `Test sent to connected ${channel.data} clients with notification permission`,
              };
            },
          }),
          list: cliCommand({
            summary: "List registered push devices",
            options: { json: JSON_OPTION },
            async run(input) {
              const rows = await subscriptions.listSummaries();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ subscriptions: rows })
                  : formatSubscriptions(rows),
              };
            },
          }),
          add: cliCommand({
            summary: "Register or refresh an Expo push device",
            options: {
              token: {
                type: "string",
                required: true,
                placeholder: "expo-push-token",
                aliases: ["expo-token", "push-token", "expo-push-token"],
                description: `Expo push token the device reported, at most ${EXPO_PUSH_TOKEN_MAX_LENGTH} characters`,
              },
              platform: {
                type: "enum",
                required: true,
                values: ["ios", "android"],
                aliases: ["os"],
                description: "Device operating system",
              },
              label: {
                type: "string",
                required: true,
                placeholder: "device-label",
                aliases: ["device-label", "device", "name"],
                description: `Name shown for the device, at most ${DEVICE_LABEL_MAX_LENGTH} characters`,
              },
              json: JSON_OPTION,
            },
            async run(input) {
              const parsed = addPushSubscriptionInputSchema.safeParse({
                expoPushToken: input.options.token,
                platform: input.options.platform,
                deviceLabel: input.options.label,
              });
              if (!parsed.success) {
                throw new PluginCliError(
                  parsed.error.issues.map((issue) => issue.message).join("; "),
                  { code: "invalid_device" },
                );
              }
              const result = await subscriptions.add(parsed.data);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `${result.created ? "Registered" : "Refreshed"} push device ${result.id}`,
              };
            },
          }),
          remove: cliCommand({
            summary: "Remove a registered push device",
            positionals: [
              {
                name: "id",
                description:
                  "Subscription id, as `bb push-notifications list` prints it",
                required: true,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const id = input.positionals.id;
              if (!(await subscriptions.remove(id))) {
                throw new PluginCliError(`Push subscription not found: ${id}`, {
                  code: "subscription_not_found",
                  hint: "Run `bb push-notifications list` for the registered ids.",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ id, removed: true })
                  : `Removed push device ${id}`,
              };
            },
          }),
          status: cliCommand({
            summary: "Show push delivery status",
            options: { json: JSON_OPTION },
            async run(input) {
              const view = await status();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(view)
                  : formatStatus(view),
              };
            },
          }),
        },
      }),
    );

    bb.events.on("interaction.pending", (payload) => {
      sender.onInteractionPending(payload);
    });
    bb.events.on("thread.idle", (payload) => {
      sender.onThreadIdle(payload);
    });
    bb.events.on("thread.failed", (payload) => {
      sender.onThreadFailed(payload);
    });
    bb.background.service("push-sender", {
      async start(signal) {
        await sender.start();
        try {
          await waitForAbort(signal);
        } finally {
          await sender.stop();
        }
      },
    });
  };
}

export default createPushNotificationsPlugin();
