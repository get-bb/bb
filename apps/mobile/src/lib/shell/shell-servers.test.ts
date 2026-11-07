import { describe, expect, it } from "vitest";
import type { ServerProfile } from "../profiles/profile";
import { bridgeServersForProfiles, canSwitchToProfile } from "./shell-servers";

const profiles: ServerProfile[] = [
  {
    id: "studio",
    mode: "connect",
    serverUrl: "https://studio.getbb.app",
    label: "Studio",
    createdAt: 1,
    handle: "studio",
    credential: "secret-credential",
  },
  {
    id: "laptop",
    mode: "direct",
    serverUrl: "http://user:password@192.168.1.4:38886/team",
    label: "Laptop",
    createdAt: 2,
  },
];

describe("shell server list", () => {
  it("offers each saved server by origin, never its credential, path or login", () => {
    const servers = bridgeServersForProfiles(profiles, "laptop");
    expect(servers).toEqual([
      {
        id: "studio",
        name: "Studio",
        origin: "https://studio.getbb.app",
        kind: "account",
        active: false,
      },
      {
        id: "laptop",
        name: "Laptop",
        origin: "http://192.168.1.4:38886",
        kind: "custom",
        active: true,
      },
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/secret|password|team/u);
  });

  it("switches only to another saved server", () => {
    expect(canSwitchToProfile(profiles, "laptop", "studio")).toBe(true);
    expect(canSwitchToProfile(profiles, "laptop", "laptop")).toBe(false);
    expect(canSwitchToProfile(profiles, "laptop", "https://evil.example")).toBe(
      false,
    );
  });
});
