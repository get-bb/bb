import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  addPushSubscriptionInputSchema,
  AGENT_NOTIFICATION_MESSAGE_MAX_LENGTH,
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
  createNotificationPreferences,
  describeNotificationSource,
  NOTIFICATION_LEVEL_LABELS,
  notificationLevelSchema,
  ownNotificationLevelSchema,
  type ThreadNotifications,
} from "./preferences.js";
import {
  createPushSender,
  type CreatePushSenderArgs,
  type ExplicitNotificationRefusal,
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
  agentNotifications: boolean;
  agentNotifyCooldownMinutes: string;
  defaultLevel: string;
  childLevel: string;
  relayUrl: string;
  lastSendOutcome: LastSendOutcome;
}

const AGENT_NOTIFY_TOOL_NAME = "notify_user";
const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

function describeRefusal(reason: ExplicitNotificationRefusal): {
  message: string;
  hint?: string;
} {
  switch (reason) {
    case "disabled":
      return {
        message: "Agent notifications are turned off",
        hint: "Turn them on with `bb plugin config push-notifications set agentNotifications true`.",
      };
    case "cooldown":
      return {
        message: "A notification was recently attempted for this thread",
        hint: "Wait for the cooldown to pass before sending another.",
      };
    case "thread-unavailable":
      return {
        message: "This thread cannot be notified right now",
        hint: "The thread may be archived, deleted, or hidden.",
      };
    case "sender-stopped":
      return {
        message: "Push delivery is not running",
        hint: "Reload the plugin with `bb plugin reload push-notifications`.",
      };
    case "empty-message":
      return { message: "The notification message was empty" };
  }
}

function explicitChannels(result: {
  mobile: number;
  web: boolean;
  desktop: boolean;
}): string[] {
  return [
    ...(result.web ? ["web"] : []),
    ...(result.desktop ? ["desktop"] : []),
    ...(result.mobile > 0 ? [`${result.mobile} mobile`] : []),
  ];
}

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
    `Default level: ${status.defaultLevel}`,
    `Child thread level: ${status.childLevel}`,
    `Agent notifications: ${status.agentNotifications}`,
    `Agent notification cooldown: ${status.agentNotifyCooldownMinutes} minutes`,
    `Subscriptions: ${status.subscriptionCount}`,
    `Relay URL: ${status.relayUrl}`,
    `Last send: ${formatLastOutcome(status.lastSendOutcome)}`,
  ].join("\n");
}

function formatThreadNotifications(
  threadId: string,
  row: ThreadNotifications,
): string {
  return `Notifications for ${threadId}: ${row.effective} (${describeNotificationSource(row)})`;
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
      defaultLevel: {
        type: "select",
        label: "Default notifications",
        description:
          "For threads you haven't set. Needs input only skips finished turns.",
        options: [...notificationLevelSchema.options],
        experimental_optionLabels: {
          all: NOTIFICATION_LEVEL_LABELS.all,
          "input-only": NOTIFICATION_LEVEL_LABELS["input-only"],
          muted: NOTIFICATION_LEVEL_LABELS.muted,
        },
        default: "all",
        experimental_schema: notificationLevelSchema,
      },
      childLevel: {
        type: "select",
        label: "Child thread notifications",
        description:
          "For child threads you haven't set. A thread's level also limits its child threads.",
        options: [...ownNotificationLevelSchema.options],
        experimental_optionLabels: {
          inherit: NOTIFICATION_LEVEL_LABELS.inherit,
          all: NOTIFICATION_LEVEL_LABELS.all,
          "input-only": NOTIFICATION_LEVEL_LABELS["input-only"],
          muted: NOTIFICATION_LEVEL_LABELS.muted,
        },
        default: "input-only",
        experimental_schema: ownNotificationLevelSchema,
      },
      expoPushUrl: {
        type: "string",
        label: "Expo push relay URL",
        description: "The Expo push relay endpoint used for mobile delivery.",
        default: DEFAULT_EXPO_PUSH_URL,
        experimental_schema: z.string().url(),
      },
      agentNotifications: {
        type: "boolean",
        label: "Model notifications",
        description:
          "Let the agent push you when it finishes work or gets blocked and you asked it to. Independent of thread levels.",
        default: true,
      },
      agentNotifyCooldownMinutes: {
        type: "select",
        label: "Model notification cooldown",
        description:
          "How long a thread waits after a model notification attempt, including failed attempts. 0 disables the limit.",
        options: ["0", "1", "5", "15", "60"],
        experimental_optionLabels: {
          "0": "No limit",
          "1": "1 minute",
          "5": "5 minutes",
          "15": "15 minutes",
          "60": "1 hour",
        },
        default: "5",
      },
    });
    const preferences = createNotificationPreferences({
      bb,
      getDefaults: async () => {
        const { defaultLevel, childLevel } = await settings.get();
        return {
          defaultLevel: notificationLevelSchema.parse(defaultLevel),
          childLevel: ownNotificationLevelSchema.parse(childLevel),
        };
      },
      publish: (threadIds) =>
        bb.rpc.experimental_invalidate(threadIds.map((id) => `thread:${id}`)),
    });
    const subscriptions = createPushSubscriptionStore(bb, {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createId === undefined ? {} : { createId: options.createId }),
    });
    const sender = createPushSender({
      bb,
      subscriptions,
      getSettings: () => settings.get(),
      getNotificationLevel: (thread) => preferences.effectiveLevel(thread),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.coalesceMs === undefined
        ? {}
        : { coalesceMs: options.coalesceMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    async function status(): Promise<StatusView> {
      const [
        {
          expoPushUrl,
          mobileEnabled,
          webEnabled,
          desktopEnabled,
          agentNotifications,
          agentNotifyCooldownMinutes,
          defaultLevel,
          childLevel,
        },
        rows,
      ] = await Promise.all([settings.get(), subscriptions.list()]);
      return {
        enabled: true,
        subscriptionCount: rows.length,
        mobileEnabled,
        webEnabled,
        desktopEnabled,
        agentNotifications,
        agentNotifyCooldownMinutes,
        defaultLevel,
        childLevel,
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
      "notifications.send": async ({ threadId, message }) => {
        const result = await sender.sendNow({ threadId, message });
        if (result.status === "refused") {
          const refusal = describeRefusal(result.reason);
          throw new Error(refusal.message);
        }
        const delivered = {
          mobile: result.mobile,
          web: result.web,
          desktop: result.desktop,
        };
        if (result.status === "failed") {
          return {
            status: "failed" as const,
            delivered,
            reason: result.reason,
          };
        }
        if (result.status === "undelivered") {
          return { status: "undelivered" as const, delivered };
        }
        return { status: "sent" as const, delivered };
      },
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
      "threadNotifications.keyed": async ({ keys }) => {
        const rows = await preferences.list(keys);
        return Object.fromEntries(
          keys.map((key) => [
            key,
            rows[key] ?? { own: "inherit" as const, ancestorCap: null },
          ]),
        );
      },
      "threadNotifications.list": async ({ threadIds }) => ({
        threads: await preferences.list(threadIds),
      }),
      "threadNotifications.set": ({ threadId, level }) =>
        preferences.set(threadId, level),
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
          notify: cliCommand({
            summary: "Send a push notification for a thread",
            description:
              "Sends immediately, ignoring the thread's notification level. Fails when model notifications are disabled or the thread is in its cooldown.",
            options: {
              message: {
                type: "string",
                required: true,
                placeholder: "message",
                aliases: ["body", "text"],
                stdin: true,
                description: `Notification text, at most ${AGENT_NOTIFICATION_MESSAGE_MAX_LENGTH} characters`,
              },
              thread: {
                type: "string",
                placeholder: "thread-id",
                aliases: ["thread-id"],
                description:
                  "Thread to notify about; defaults to the invoking thread",
              },
              json: JSON_OPTION,
            },
            async run(input, ctx) {
              const threadId = input.options.thread ?? ctx.threadId;
              if (threadId === undefined) {
                throw new PluginCliError("No thread to notify about", {
                  code: "missing_thread",
                  hint: "Pass --thread <id> or run this from a thread.",
                });
              }
              const parsed = z
                .object({
                  threadId: z.string().min(1),
                  message: z
                    .string()
                    .trim()
                    .min(1)
                    .max(AGENT_NOTIFICATION_MESSAGE_MAX_LENGTH),
                })
                .strict()
                .safeParse({ threadId, message: input.options.message });
              if (!parsed.success) {
                throw new PluginCliError(
                  parsed.error.issues.map((issue) => issue.message).join("; "),
                  { code: "invalid_notification" },
                );
              }
              const result = await sender.sendNow(parsed.data);
              if (result.status === "refused") {
                const refusal = describeRefusal(result.reason);
                throw new PluginCliError(refusal.message, {
                  code: result.reason,
                  ...(refusal.hint === undefined ? {} : { hint: refusal.hint }),
                });
              }
              const delivered = {
                mobile: result.mobile,
                web: result.web,
                desktop: result.desktop,
              };
              if (result.status === "undelivered") {
                throw new PluginCliError(
                  "No delivery channels or devices are available; nothing was sent",
                  {
                    code: "no_recipients",
                    hint: "Enable a channel or register a device first.",
                  },
                );
              }
              if (result.status === "failed") {
                const delivered = explicitChannels(result);
                throw new PluginCliError(
                  delivered.length > 0
                    ? `Notification reached ${delivered.join(", ")}, but processing reported an error: ${result.reason}`
                    : `Notification delivery failed: ${result.reason}`,
                  {
                    code: "delivery_failed",
                    hint: "Check the Expo relay URL and this machine's network.",
                  },
                );
              }
              const channels = explicitChannels(result);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ status: "sent", delivered })
                  : `Sent a push notification (${channels.join(", ")})`,
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
          thread: cliCommand({
            summary: "Show or set a thread's notification level",
            description:
              "Without --level, prints the resolved level and where it comes from. A thread uses its own level, else childLevel if it has a parent, else defaultLevel; every ancestor's own level caps it.",
            positionals: [
              {
                name: "thread",
                description: "Thread id",
                required: true,
              },
            ],
            options: {
              level: {
                type: "enum",
                values: ownNotificationLevelSchema.options,
                description:
                  "Set the thread's own level; inherit clears it so the parent or default applies",
              },
              json: JSON_OPTION,
            },
            async run(input) {
              const threadId = input.positionals.thread;
              let row: ThreadNotifications;
              try {
                if (input.options.level !== undefined) {
                  await preferences.set(threadId, input.options.level);
                }
                row = await preferences.get(threadId);
              } catch (error) {
                throw new PluginCliError(
                  error instanceof Error ? error.message : String(error),
                  { code: "thread_not_found" },
                );
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ threadId, ...row })
                  : formatThreadNotifications(threadId, row),
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

    bb.agents.registerTool({
      name: AGENT_NOTIFY_TOOL_NAME,
      description:
        "Send the user a push notification about this thread. Call it only when the user asked to be notified, for example when a task is finished or you are blocked waiting for them. Do not call it on every turn. Keep the message short and free of secrets: it leaves the server in the push payload and is ordinary tool input in the conversation.",
      presentation: {
        label: { pending: "Notifying you", completed: "Notified you" },
        icon: { glyph: "push-notifications/ringing" },
      },
      parameters: z
        .object({
          message: z
            .string()
            .trim()
            .min(1)
            .max(AGENT_NOTIFICATION_MESSAGE_MAX_LENGTH),
        })
        .strict(),
      async execute(input, ctx): Promise<PluginAgentToolResult> {
        const result = await sender.sendNow({
          threadId: ctx.threadId,
          message: input.message,
        });
        if (result.status === "refused") {
          const refusal = describeRefusal(result.reason);
          return {
            content: [{ type: "text", text: refusal.message }],
            isError: true,
          };
        }
        if (result.status === "undelivered") {
          return {
            content: [
              {
                type: "text",
                text: "The notification was not delivered: no delivery channels or devices are available. Tell the user in your reply instead.",
              },
            ],
            isError: true,
          };
        }
        if (result.status === "failed") {
          const delivered = explicitChannels(result);
          return {
            content: [
              {
                type: "text",
                text:
                  delivered.length > 0
                    ? `The notification reached ${delivered.join(", ")}, but processing reported an error: ${result.reason}.`
                    : `The notification could not be delivered: ${result.reason}. Tell the user in your reply instead.`,
              },
            ],
            isError: true,
          };
        }
        return `Sent a push notification (${explicitChannels(result).join(", ")}).`;
      },
    });

    bb.events.on("interaction.pending", (payload) => {
      sender.onInteractionPending(payload);
    });
    bb.events.on("thread.idle", (payload) => {
      sender.onThreadIdle(payload);
    });
    bb.events.on("thread.failed", (payload) => {
      sender.onThreadFailed(payload);
    });
    bb.events.on("experimental_thread.parentChanged", ({ thread }) =>
      preferences.publishSubtree(thread.id),
    );
    bb.events.on("thread.unarchived", ({ thread }) =>
      preferences.publishSubtree(thread.id),
    );
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
