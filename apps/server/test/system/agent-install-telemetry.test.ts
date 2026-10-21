import { defaultFeatureFlags } from "@bb/domain";
import type { ProviderCliInstallEvent } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { captureAgentInstallTelemetry } from "../../src/services/system/agent-install-telemetry.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";

function installEvents(
  provider: string,
  command: string,
  success: boolean,
): ProviderCliInstallEvent[] {
  return [
    { type: "started", provider, command },
    { type: "output", provider, stream: "stdout", text: "C:\\Users\\me\n" },
    {
      type: "completed",
      provider,
      exitCode: success ? 0 : 1,
      signal: null,
      success,
    },
  ];
}

function capture(args: {
  enabled: boolean;
  providerId: string;
  builtIn?: boolean;
  actionKind?: "install" | "update";
  events: ProviderCliInstallEvent[];
}) {
  const spy = vi.fn<TelemetryService["capture"]>();
  captureAgentInstallTelemetry({
    telemetry: { capture: spy, setEnabled: () => {} },
    featureFlags: {
      ...defaultFeatureFlags,
      agentInstallTelemetry: args.enabled,
    },
    providerId: args.providerId,
    isBuiltinProvider: () => args.builtIn ?? true,
    actionKind: args.actionKind ?? "install",
    events: args.events,
  });
  return spy.mock.calls.map(([event]) => event);
}

describe("agent install telemetry", () => {
  it("is on by default, and switching it off sends nothing", () => {
    expect(defaultFeatureFlags.agentInstallTelemetry).toBe(true);
    expect(
      capture({
        enabled: false,
        providerId: "pi",
        events: installEvents("pi", "npm install -g pkg@latest", true),
      }),
    ).toEqual([]);
  });

  it("sends only enum properties for each install method when switched on", () => {
    expect(
      capture({
        enabled: true,
        providerId: "pi",
        events: installEvents(
          "pi",
          "'C:\\Program Files\\bb\\bb.exe' 'C:\\Program Files\\bb\\resources\\node_modules\\npm\\bin\\npm-cli.js' install --global",
          false,
        ),
      }),
    ).toEqual([
      {
        name: "agent_install_started",
        properties: { provider: "pi", install_method: "bundled_npm" },
      },
      {
        name: "agent_install_finished",
        properties: {
          provider: "pi",
          install_method: "bundled_npm",
          outcome: "failed",
        },
      },
    ]);
    expect(
      capture({
        enabled: true,
        providerId: "pi",
        events: installEvents("pi", "npm.cmd install -g pkg@latest", true),
      }),
    ).toContainEqual({
      name: "agent_install_finished",
      properties: {
        provider: "pi",
        install_method: "npm",
        outcome: "succeeded",
      },
    });
    expect(
      capture({
        enabled: true,
        providerId: "codex",
        events: installEvents("codex", "sh -c 'curl -fsSL x | sh'", true),
      }),
    ).toContainEqual({
      name: "agent_install_finished",
      properties: {
        provider: "codex",
        install_method: "native",
        outcome: "succeeded",
      },
    });
  });

  it("ignores updates and providers that are not built in", () => {
    expect(
      capture({
        enabled: true,
        providerId: "pi",
        actionKind: "update",
        events: installEvents("pi", "npm install -g pkg@latest", true),
      }),
    ).toEqual([]);
    expect(
      capture({
        enabled: true,
        providerId: "custom-acp",
        builtIn: false,
        events: installEvents("custom-acp", "npm install -g x", true),
      }),
    ).toEqual([]);
  });
});
