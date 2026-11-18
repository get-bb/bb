import { getAppProfileClientRegistry } from "@/app-shell/client-registry";
import { nativeCookieStore, nativeSessionCache } from "@/lib/native";
import type { ServerProfile } from "@/lib/profiles";
import type { ProfileClient } from "@/lib/sdk";
import { createSessionScheduler } from "@/lib/session";

export async function withWidgetSdk<T>(
  profile: ServerProfile,
  signal: AbortSignal | undefined,
  read: (sdk: ProfileClient["sdk"]) => Promise<T>,
): Promise<T> {
  const { sdk } = getAppProfileClientRegistry().getClientForProfile(profile);
  if (profile.mode === "direct") return read(sdk);

  const session = createSessionScheduler({
    cookieStore: nativeCookieStore,
    sessionCache: nativeSessionCache,
  });
  const cancel = () => session.stop();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw new Error("Widget request canceled");
    const state = await session.start(profile);
    if (signal?.aborted) throw new Error("Widget request canceled");
    if (state.status !== "authenticated") {
      throw new Error(
        "Could not sign in to this server. Check the saved server in bb.",
      );
    }
    return await read(sdk);
  } finally {
    signal?.removeEventListener("abort", cancel);
    session.stop();
  }
}
