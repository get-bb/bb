import { EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchOnlineRpcCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  DISPATCH_TEST_BRIDGE_LAUNCH,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

/**
 * `host.list_commands` with a bridge launch: the static scan of the
 * provider's native roots is merged with what the provider's bridge lists
 * for the cwd (`command/list`), and the bridge's diagnostics ride along.
 * Without a launch, or without a cwd, or when the bridge does not implement
 * the method, the static scan stands alone.
 */
describe("host.list_commands bridge merge", () => {
  const emptyRoots = {
    skills: { user: [], project: [] },
    commands: { user: [], project: [] },
    resolved: EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  };

  it("merges bridge commands and diagnostics with the static scan", async () => {
    const cwd = await makeTempDir("bb-list-commands-bridge-");
    const harness = createHarness({ workspacePath: cwd });
    const options = harness.dispatchOptions();
    options.listProviderCommands = vi.fn(async () => ({
      supported: true as const,
      commands: [
        {
          name: "project-smoke",
          source: "command" as const,
          origin: "project" as const,
          description: "Project smoke command",
          argumentHint: null,
        },
      ],
      diagnostics: ['Failed to load Pi extension "broken.ts": syntax error'],
    }));

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_commands",
        providerId: "pi",
        cwd,
        nativeRoots: emptyRoots,
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      },
      options,
    );

    expect(result.commands.map((command) => command.name)).toEqual(["project-smoke"]);
    expect(result.diagnostics).toEqual(['Failed to load Pi extension "broken.ts": syntax error']);
    expect(options.listProviderCommands).toHaveBeenCalledWith({
      providerId: "pi",
      bridgeLaunch: expect.objectContaining({ pluginId: "provider-pi" }),
      cwd,
    });
  });

  it("keeps the static scan and reports a bridge that fails to answer", async () => {
    const cwd = await makeTempDir("bb-list-commands-failing-");
    const harness = createHarness({ workspacePath: cwd });
    const options = harness.dispatchOptions();
    options.listProviderCommands = vi.fn(async () => {
      throw new Error("pi exited before its extension reported ready");
    });

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_commands",
        providerId: "pi",
        cwd,
        nativeRoots: emptyRoots,
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      },
      options,
    );

    expect(result.commands).toEqual([]);
    expect(result.diagnostics).toEqual([
      "pi could not list its commands: pi exited before its extension reported ready",
    ]);
  });

  it("keeps the static scan alone without a launch, without a cwd, or for a bridge without the method", async () => {
    const cwd = await makeTempDir("bb-list-commands-static-");
    const harness = createHarness({ workspacePath: cwd });
    const options = harness.dispatchOptions();
    const listProviderCommands = vi.fn(async () => ({ supported: false as const }));
    options.listProviderCommands = listProviderCommands;

    const withoutLaunch = await dispatchOnlineRpcCommand(
      { type: "host.list_commands", providerId: "pi", cwd, nativeRoots: emptyRoots },
      options,
    );
    expect(withoutLaunch).toEqual({ commands: [], diagnostics: [] });
    const withoutCwd = await dispatchOnlineRpcCommand(
      {
        type: "host.list_commands",
        providerId: "pi",
        cwd: null,
        nativeRoots: emptyRoots,
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      },
      options,
    );
    expect(withoutCwd).toEqual({ commands: [], diagnostics: [] });
    expect(listProviderCommands).not.toHaveBeenCalled();

    const unsupported = await dispatchOnlineRpcCommand(
      {
        type: "host.list_commands",
        providerId: "pi",
        cwd,
        nativeRoots: emptyRoots,
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      },
      options,
    );
    expect(unsupported).toEqual({ commands: [], diagnostics: [] });
    expect(listProviderCommands).toHaveBeenCalledOnce();
  });
});
