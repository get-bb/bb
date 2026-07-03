// bb-plugin-slack-bot — the headless "Slack bot" hero plugin (no frontend).
//
// Mention the bot in Slack → it spawns a BB thread in the configured project
// (server-resolved project-default environment) and posts the agent's answer
// back into the Slack thread when the BB thread goes idle.
//
// Surfaces demonstrated: secret + project settings, bb.http webhook with
// Slack signature verification, bb.sdk.threads.spawn/send with plugin
// attribution, bb.storage.kv mapping Slack threads to BB threads,
// bb.on("thread.idle"), and bb.status.needsConfiguration.
//
// The type-only import is erased at load time; this file runs as-is.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BbPluginApi } from "@bb/plugin-sdk";

const SIGNATURE_VERSION = "v0";
/** Slack replays are rejected past this age (Slack's own recommendation). */
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

const CONFIGURE_HINT =
  "Set botToken, signingSecret, and project with `bb plugin config slack-bot`, " +
  "then `bb plugin reload slack-bot`.";

/**
 * Verify Slack's request signature (x-slack-signature): HMAC-SHA256 of
 * "v0:<timestamp>:<raw body>" with the app's signing secret. This is why the
 * /events route can use auth "none" — every request proves it came from
 * Slack.
 */
function verifySlackSignature(args: {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}): boolean {
  const timestamp = Number(args.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }
  const expected =
    `${SIGNATURE_VERSION}=` +
    createHmac("sha256", args.signingSecret)
      .update(`${SIGNATURE_VERSION}:${args.timestamp}:${args.rawBody}`)
      .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const presentedBuffer = Buffer.from(args.signature, "utf8");
  return (
    expectedBuffer.length === presentedBuffer.length &&
    timingSafeEqual(expectedBuffer, presentedBuffer)
  );
}

/** "<@U123> run the tests please" → "run the tests please". */
function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

interface SlackTarget {
  channel: string;
  threadTs: string;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    botToken: {
      type: "string",
      label: "Slack bot token (xoxb-...)",
      description: "OAuth bot token with chat:write; used to post replies.",
      secret: true,
    },
    signingSecret: {
      type: "string",
      label: "Slack signing secret",
      description: "Verifies that webhook events really come from Slack.",
      secret: true,
    },
    channelId: {
      type: "string",
      label: "Announcement channel ID",
      description:
        "Optional channel for bot notices; replies always go to the mention's thread.",
    },
    project: {
      type: "project",
      label: "BB project for mention threads",
      description: "Mentions spawn BB threads in this project.",
    },
  });

  // Loaded-but-unconfigured is a first-class state: report it instead of
  // crash-looping. The webhook stays registered and returns 503 until the
  // settings above are saved and the plugin is reloaded.
  const initial = await settings.get();
  if (!initial.botToken || !initial.signingSecret || !initial.project) {
    bb.status.needsConfiguration(CONFIGURE_HINT);
  }

  // Slack Events API webhook. Point the Slack app's event subscription at
  //   <server>/api/v1/plugins/slack-bot/http/events
  // auth "none" is justified because every request is checked against the
  // signing secret above; unsigned requests never reach the handlers below.
  bb.http.route(
    "POST",
    "/events",
    async (context) => {
      // Read settings per request: they can change after load.
      const current = await settings.get();
      if (!current.signingSecret) {
        return context.json(
          { ok: false, error: `slack-bot is not configured. ${CONFIGURE_HINT}` },
          503,
        );
      }
      const rawBody = await context.req.text();
      const verified = verifySlackSignature({
        signingSecret: current.signingSecret,
        timestamp: context.req.header("x-slack-request-timestamp") ?? "",
        signature: context.req.header("x-slack-signature") ?? "",
        rawBody,
      });
      if (!verified) {
        return context.json({ ok: false, error: "invalid Slack signature" }, 401);
      }

      let body: any;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return context.json({ ok: false, error: "body must be JSON" }, 400);
      }

      // Slack's endpoint handshake when event subscriptions are enabled.
      if (body?.type === "url_verification") {
        return context.json({ challenge: body.challenge });
      }

      if (body?.type === "event_callback" && body.event?.type === "app_mention") {
        const event = body.event as {
          channel: string;
          text: string;
          ts: string;
          thread_ts?: string;
        };
        if (!current.project) {
          bb.log.warn(`mention ignored — no project configured. ${CONFIGURE_HINT}`);
          return context.json({ ok: true });
        }
        const prompt = stripMentions(event.text);
        const threadTs = event.thread_ts ?? event.ts;

        // Second mention in a Slack thread we already track → follow-up.
        const existing = await bb.storage.kv.get<string>(`slack:${threadTs}`);
        if (existing !== undefined) {
          await bb.sdk.threads.send({
            threadId: existing,
            mode: "auto",
            input: [{ type: "text", text: prompt }],
          });
          return context.json({ ok: true });
        }

        // First mention → spawn a BB thread. The server resolves the
        // project-default environment; bb.sdk fills in origin "plugin" +
        // originPluginId automatically.
        const thread = await bb.sdk.threads.spawn({
          projectId: current.project,
          prompt,
          environment: { type: "project-default" },
          title: `Slack: ${prompt.slice(0, 60) || "mention"}`,
        });
        await bb.storage.kv.set(`slack:${threadTs}`, thread.id);
        await bb.storage.kv.set(`bb:${thread.id}`, {
          channel: event.channel,
          threadTs,
        } satisfies SlackTarget);
        bb.log.info(`mention in ${event.channel} → thread ${thread.id}`);
        return context.json({ ok: true });
      }

      // Other event types are acknowledged so Slack does not retry them.
      return context.json({ ok: true });
    },
    { auth: "none" },
  );

  // When a BB thread this plugin spawned goes idle, post the agent's last
  // message back into the originating Slack thread.
  bb.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const target = await bb.storage.kv.get<SlackTarget>(`bb:${thread.id}`);
    if (target === undefined || lastAssistantText === null) return;
    const { botToken } = await settings.get();
    if (!botToken) {
      bb.status.needsConfiguration(CONFIGURE_HINT);
      return;
    }
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: target.channel,
        thread_ts: target.threadTs,
        text: lastAssistantText,
      }),
    });
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      bb.log.warn(`chat.postMessage failed: ${result.error ?? "unknown error"}`);
    }
  });

  // Socket Mode (no public URL needed) would live here as a background
  // service, but it requires a WebSocket client dependency (e.g.
  // @slack/socket-mode), which this dependency-free example omits — webhook
  // (Events API) mode above covers the same flow:
  //
  // bb.background.service("slack-socket", {
  //   async start(signal) {
  //     // connect with the app-level token; resolve when `signal` aborts.
  //   },
  // });
}
