import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import { createPushSubscriptionStore } from "../subscriptions.js";

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error("Expected sender source and APNs output path");
const { createPushSender }: typeof import("../sender.js") = await import(
  pathToFileURL(resolve(source)).href
);
const thread = makeThreadResponse({
  id: "thr_23456789ab",
  projectId: "proj_23456789ab",
  title: "Release review",
  latestAttentionAt: 100,
});
const fake = createFakePluginHost({
  pluginId: "push-notifications",
  sdk: {
    threads: {
      get: async () => thread,
      resolveMentions: async () => [
        { threadId: "thr_3456789abc", projectId: thread.projectId, label: "Fix login redirect" },
        { threadId: "thr_456789abcd", projectId: thread.projectId, label: "Polish settings and notification preferences" },
      ],
    },
  },
});
const subscriptions = createPushSubscriptionStore(fake.bb);
await subscriptions.add({
  expoPushToken: "ExponentPushToken[simulator]",
  platform: "ios",
  deviceLabel: "CI simulator",
});
let delivered = false;
const sender = createPushSender({
  bb: fake.bb,
  subscriptions,
  coalesceMs: 1,
  getDeliverySettings: async () => ({ mobileEnabled: true, webEnabled: false, desktopEnabled: false }),
  getExpoPushUrl: async () => "https://expo.test/push",
  fetch: async (_url, init) => {
    const messages = z.array(z.object({
      title: z.string(),
      body: z.string(),
      data: z.record(z.string(), z.string()),
    })).nonempty().parse(JSON.parse(init.body));
    const message = messages[0];
    await writeFile(output, JSON.stringify({
      aps: { alert: { title: message.title, body: message.body }, sound: "default" },
      body: message.data,
    }, null, 2));
    delivered = true;
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ status: "ok" }] }) };
  },
});
try {
  await sender.start();
  sender.onThreadIdle({
    thread,
    lastAssistantText: "See @thread:thr_3456789abc and thr_456789abcd",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await sender.settle();
  if (!delivered) throw new Error("The sender did not produce a notification");
} finally {
  await sender.stop();
  await fake.harness.lifecycle.dispose();
}
