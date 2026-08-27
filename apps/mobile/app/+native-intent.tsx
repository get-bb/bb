// Expo Router calls `redirectSystemPath` for every incoming URL (cold start
// and while running) before routing it: the `bb://` scheme, universal links
// (`https://<handle>.getbb.app/threads/<id>`), the dev-client's own URLs.
// Pure resolution lives in src/lib/links and src/lib/shell; this file does the
// RN side: pick the resolver for the current shell mode, activate the profile
// that owns a web link, wait for its connection, and send unknown servers to
// the add-server screen with the link remembered.
import { waitForActiveConnection } from "@/app-shell/connector";
import { e2eModeEnabled } from "@/app-shell/e2e";
import { addServerPathForLink } from "@/lib/links";
import { getProfileStore } from "@/lib/native";
import { resolveShellIncomingLink } from "@/lib/shell";

export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  try {
    const store = getProfileStore();
    await store.load();
    const snapshot = store.getSnapshot();
    const context = {
      profiles: snapshot.profiles,
      activeProfileId: snapshot.activeProfileId,
      developerRoutesEnabled: e2eModeEnabled,
    };
    // The page owns almost every surface, so a link resolves to one WebView
    // route carrying a web path rather than a native route.
    const resolution = resolveShellIncomingLink(path, context);
    switch (resolution.kind) {
      case "passthrough":
        return path;
      case "navigate":
        if (resolution.profileId !== null) {
          await store.setActiveProfile(resolution.profileId);
          await waitForActiveConnection(resolution.profileId);
        }
        return resolution.path;
      case "unknown-server":
        return addServerPathForLink(resolution.serverUrl, resolution.path);
    }
  } catch (error) {
    console.warn("Could not resolve incoming link", path, error);
    return "/";
  }
}
