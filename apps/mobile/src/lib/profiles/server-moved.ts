import type { ServerMovedResponse } from "../sdk/mobile-fetch";
import type { ProfileStore } from "./profile-store";

export interface ServerMovedProfileHandler {
  handle(profileId: string, moved: ServerMovedResponse): Promise<boolean>;
}

export interface CreateServerMovedProfileHandlerDeps {
  store: Pick<ProfileStore, "listProfiles" | "load" | "updateProfile">;
  notify(message: string): void;
}

export function createServerMovedProfileHandler(
  deps: CreateServerMovedProfileHandlerDeps,
): ServerMovedProfileHandler {
  let chain: Promise<unknown> = Promise.resolve();

  async function apply(
    profileId: string,
    moved: ServerMovedResponse,
  ): Promise<boolean> {
    await deps.store.load();
    const profile = deps.store
      .listProfiles()
      .find((candidate) => candidate.id === profileId);
    if (
      profile === undefined ||
      profile.mode !== "direct" ||
      profile.serverUrl === moved.serverUrl
    ) {
      return false;
    }
    await deps.store.updateProfile(profileId, { serverUrl: moved.serverUrl });
    deps.notify(`Server moved to ${moved.toHostName}`);
    return true;
  }

  return {
    handle(profileId, moved) {
      const run = chain.then(() => apply(profileId, moved));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
