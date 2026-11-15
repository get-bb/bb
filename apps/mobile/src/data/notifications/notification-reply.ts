import { z } from "zod";
import type { ServerProfile } from "@/lib/profiles/profile";
import type { PushStorage } from "./push-store";

export const THREAD_REPLY_CATEGORY = "bb-thread-reply";
export const THREAD_REPLY_ACTION = "bb-reply";
const SENT_REPLIES_KEY = "bb.push.sentReplies";

const replySchema = z.object({
  actionIdentifier: z.literal(THREAD_REPLY_ACTION),
  userText: z.string().trim().min(1),
  notification: z.object({
    request: z.object({
      identifier: z.string().min(1),
      content: z.object({
        data: z.object({
          threadId: z.string().min(1),
          subscriptionId: z.string().min(1),
        }),
      }),
    }),
  }),
});

export interface NotificationReplyDeps {
  storage: PushStorage;
  getProfiles(): Promise<readonly ServerProfile[]>;
  getRegistrations(): Readonly<
    Record<string, { subscriptionId: string | null }>
  >;
  send(profile: ServerProfile, threadId: string, text: string): Promise<void>;
  dismiss(notificationId: string): Promise<void>;
}

export function createNotificationReplyHandler(deps: NotificationReplyDeps) {
  let queue = Promise.resolve();
  let delivered: string[] = [];

  return async (response: unknown): Promise<boolean> => {
    const parsed = replySchema.safeParse(response);
    if (!parsed.success) return false;
    const { userText, notification } = parsed.data;
    const { identifier, content } = notification.request;
    const send = async (): Promise<boolean> => {
      if (delivered.includes(identifier)) return true;
      let sent: string[] = [];
      try {
        const stored = deps.storage.getString(SENT_REPLIES_KEY);
        const parsedIds = z
          .array(z.string())
          .safeParse(JSON.parse(stored ?? "[]"));
        if (parsedIds.success) sent = parsedIds.data;
      } catch {}
      if (sent.includes(identifier)) return true;
      const profiles = await deps.getProfiles();
      const registrations = deps.getRegistrations();
      const profile = profiles.find(
        (candidate) =>
          registrations[candidate.id]?.subscriptionId ===
          content.data.subscriptionId,
      );
      if (!profile)
        throw new Error(
          "This notification's server is no longer saved on this device.",
        );
      await deps.send(profile, content.data.threadId, userText);
      delivered = [...delivered, identifier].slice(-100);
      try {
        deps.storage.set(
          SENT_REPLIES_KEY,
          JSON.stringify([...new Set([...sent, ...delivered])].slice(-100)),
        );
      } catch {
        console.warn("Could not persist delivered notification replies");
      }
      try {
        await deps.dismiss(identifier);
      } catch {
        console.warn("Could not dismiss a delivered notification reply");
      }
      return true;
    };
    const work = queue.then(send);
    queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  };
}
