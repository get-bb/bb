import { fetchDesktopSession } from "@bb/connect-client";
import { createBrowserBbSdk } from "@bb/sdk/browser";
import * as Notifications from "expo-notifications";
import {
  createNotificationReplyHandler,
  THREAD_REPLY_ACTION,
  THREAD_REPLY_CATEGORY,
} from "@/data/notifications/notification-reply";
import { nativeCookieStore } from "@/lib/native/cookie-store";
import { getPreferencesStorage } from "@/lib/native/preferences-storage";
import { getProfileStore } from "@/lib/native/profile-store";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";
import { installSessionCookie } from "@/lib/session/cookie-store";
import { getPushStore } from "./push-storage";

let handler: ReturnType<typeof createNotificationReplyHandler> | null = null;

export function handleNotificationReply(response: unknown): Promise<boolean> {
  handler ??= createNotificationReplyHandler({
    storage: getPreferencesStorage(),
    getProfiles: async () => (await getProfileStore().load()).profiles,
    getRegistrations: () => {
      const store = getPushStore();
      store.reload();
      return store.getSnapshot().registrations;
    },
    async send(profile, threadId, text) {
      const mobileFetch = createMobileFetch((input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(20_000),
        }),
      );
      if (profile.mode === "connect") {
        const session = await fetchDesktopSession(profile, mobileFetch);
        await installSessionCookie(
          nativeCookieStore,
          profile.serverUrl,
          session,
        );
      }
      const sdk = createBrowserBbSdk({
        baseUrl: profile.serverUrl,
        fetch: mobileFetch,
      });
      await sdk.threads.send({
        threadId,
        input: [{ type: "text", text, mentions: [] }],
        mode: "queue-if-active",
      });
    },
    dismiss: (identifier) => Notifications.dismissNotificationAsync(identifier),
  });
  return handler(response);
}

export async function registerNotificationReplyCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(THREAD_REPLY_CATEGORY, [
    {
      identifier: THREAD_REPLY_ACTION,
      buttonTitle: "Reply",
      textInput: {
        submitButtonTitle: "Send",
        placeholder: "Message this thread",
      },
      options: { opensAppToForeground: true, isAuthenticationRequired: true },
    },
  ]);
}
