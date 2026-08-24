import { describe, expect, it } from "vitest";
import { bridgeLaunchProcessKey } from "./bridge-launch-process-key.js";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

describe("bridgeLaunchProcessKey", () => {
  const base: AgentRuntimeBridgeLaunch = {
    pluginId: "provider-example",
    dataDir: "/tmp/provider-example",
    source: {
      kind: "artifact",
      digest: "a".repeat(64),
      artifactPath: "/tmp/provider-example/host.mjs",
    },
    capabilities: {
      providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["full"],
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
    },
    providerOptions: { launch: { command: "example" } },
    envPassthrough: [],
  };

  it("changes with provider-owned statics and ignores object key order", () => {
    expect(bridgeLaunchProcessKey(base)).toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "example" } },
    envPassthrough: [],
      }),
    );
    expect(bridgeLaunchProcessKey(base)).not.toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "other" } },
      }),
    );
  });
});
