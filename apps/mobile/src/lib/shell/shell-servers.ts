import type { BridgeServer } from "@bb/mobile-bridge";
import type { ServerProfile } from "../profiles/profile";

export function bridgeServersForProfiles(
  profiles: readonly ServerProfile[],
  activeProfileId: string | null,
): BridgeServer[] {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.label,
    origin: new URL(profile.serverUrl).origin,
    kind: profile.mode === "connect" ? "account" : "custom",
    active: profile.id === activeProfileId,
  }));
}

export function canSwitchToProfile(
  profiles: readonly ServerProfile[],
  activeProfileId: string | null,
  id: string,
): boolean {
  return (
    id !== activeProfileId && profiles.some((profile) => profile.id === id)
  );
}
