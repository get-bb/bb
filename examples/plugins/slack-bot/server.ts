import { createHmac, timingSafeEqual } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const SIGNATURE_VERSION = "v0";
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

const CONFIGURE_HINT =
  "Set botToken, signingSecret, and project with `bb plugin config slack-bot`, " +
  "then `bb plugin reload slack-bot`.";

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

function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

interface SlackTarget {
  channel: string;
  threadTs: string;
}

type SlackJsonValue =
  | string
  | number
  | boolean
  | null
  | SlackJsonValue[]
  | { [key: string]: SlackJsonValue };
type SlackJsonObject = { [key: string]: SlackJsonValue };

interface SlackEvent {
  type: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackRequest {
  type: string;
  challenge?: string;
  event?: SlackEvent;
}

interface SlackApiResult {
  ok: boolean;
  error?: string;
}

interface SlackMentionEvent {
  channel: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

function isSlackJsonObject(value: SlackJsonValue): value is SlackJsonObject {
  return (
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function readSlackString(
  object: SlackJsonObject,
  key: string,
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  const stringValue = String(value);
  return stringValue === value ? stringValue : undefined;
}

function parseSlackRequest(rawBody: string): SlackRequest {
  // SAFETY: JSON.parse returns a value from the JSON grammar modeled by SlackJsonValue.
  const parsed = JSON.parse(rawBody) as SlackJsonValue;
  if (!isSlackJsonObject(parsed)) throw new Error("body must be an object");
  const type = readSlackString(parsed, "type");
  if (type === undefined) throw new Error("body type must be a string");
  if (type !== "event_callback") {
    const challenge = readSlackString(parsed, "challenge");
    return challenge === undefined ? { type } : { type, challenge };
  }
  const eventValue = parsed.event;
  if (!isSlackJsonObject(eventValue)) {
    throw new Error("event must be an object");
  }
  const eventType = readSlackString(eventValue, "type");
  if (eventType === undefined) throw new Error("event type must be a string");
  return {
    type,
    event: {
      type: eventType,
      channel: readSlackString(eventValue, "channel"),
      text: readSlackString(eventValue, "text"),
      ts: readSlackString(eventValue, "ts"),
      thread_ts: readSlackString(eventValue, "thread_ts"),
    },
  };
}

function parseSlackMentionEvent(event: SlackEvent): SlackMentionEvent {
  if (event.channel === undefined) throw new Error("event channel is required");
  if (event.text === undefined) throw new Error("event text is required");
  if (event.ts === undefined) throw new Error("event timestamp is required");
  const mention: SlackMentionEvent = {
    channel: event.channel,
    text: event.text,
    ts: event.ts,
  };
  if (event.thread_ts !== undefined) mention.thread_ts = event.thread_ts;
  return mention;
}

function parseSlackApiResult(rawBody: string): SlackApiResult {
  // SAFETY: JSON.parse returns a value from the JSON grammar modeled by SlackJsonValue.
  const parsed = JSON.parse(rawBody) as SlackJsonValue;
  if (!isSlackJsonObject(parsed))
    throw new Error("Slack response must be an object");
  const ok = parsed.ok === true ? true : parsed.ok === false ? false : null;
  if (ok === null) throw new Error("Slack response status must be a boolean");
  const error = readSlackString(parsed, "error");
  return error === undefined ? { ok } : { ok, error };
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

  const initial = await settings.get();
  if (!initial.botToken || !initial.signingSecret || !initial.project) {
    bb.status.needsConfiguration(CONFIGURE_HINT);
  }

  bb.http.route(
    "POST",
    "/events",
    async (context) => {
      const current = await settings.get();
      if (!current.signingSecret) {
        return context.json(
          {
            ok: false,
            error: `slack-bot is not configured. ${CONFIGURE_HINT}`,
          },
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
        return context.json(
          { ok: false, error: "invalid Slack signature" },
          401,
        );
      }

      let body: SlackRequest;
      try {
        body = parseSlackRequest(rawBody);
      } catch {
        return context.json({ ok: false, error: "body must be JSON" }, 400);
      }

      if (body?.type === "url_verification") {
        return context.json({ challenge: body.challenge });
      }

      if (
        body?.type === "event_callback" &&
        body.event?.type === "app_mention"
      ) {
        const event = parseSlackMentionEvent(body.event);
        if (!current.project) {
          bb.log.warn(
            `mention ignored — no project configured. ${CONFIGURE_HINT}`,
          );
          return context.json({ ok: true });
        }
        const prompt = stripMentions(event.text);
        const threadTs = event.thread_ts ?? event.ts;

        const existing = await bb.storage.kv.get<string>(`slack:${threadTs}`);
        if (existing !== undefined) {
          await bb.sdk.threads.send({
            threadId: existing,
            mode: "auto",
            input: [{ type: "text", text: prompt, mentions: [] }],
          });
          return context.json({ ok: true });
        }

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

      return context.json({ ok: true });
    },
    { auth: "none" },
  );

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
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
    const result = parseSlackApiResult(await response.text());
    if (!result.ok) {
      bb.log.warn(
        `chat.postMessage failed: ${result.error ?? "unknown error"}`,
      );
    }
  });
}
