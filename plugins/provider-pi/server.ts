import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { piProviderDeclaration } from "./src/declaration.js";
import {
  piModelSettingsBridgeContract,
  piModelSettingsRpcContract,
  type PiModelSettingsSnapshot,
} from "./src/model-settings-contract.js";

interface ParsedCliArgs {
  command: "list" | "set" | "enable-all";
  machine: string | null;
  json: boolean;
  modelIds: string[];
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = [...argv];
  if (args.shift() !== "models") {
    throw new Error(
      "Usage: bb pi models [list|set <model-id...>|enable-all] [--machine <id-or-name>] [--json]",
    );
  }
  const commandToken = args[0];
  let command: ParsedCliArgs["command"] = "list";
  if (commandToken === "set" || commandToken === "enable-all" || commandToken === "list") {
    command = commandToken;
    args.shift();
  }
  let machine: string | null = null;
  let json = false;
  const modelIds: string[] = [];
  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--machine") {
      const value = args.shift();
      if (!value) throw new Error("--machine requires an id or name");
      machine = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    modelIds.push(arg);
  }
  if (command === "set" && modelIds.length === 0) {
    throw new Error("bb pi models set requires at least one model id");
  }
  if (command !== "set" && modelIds.length > 0) {
    throw new Error(`bb pi models ${command} does not accept model ids`);
  }
  return { command, machine, json, modelIds };
}

async function resolveHostId(bb: BbPluginApi, machine: string | null): Promise<string> {
  const hosts = await bb.sdk.hosts.list();
  if (machine !== null) {
    const normalized = machine.toLowerCase();
    const matches = hosts.filter(
      (host) => host.id === machine || host.name.toLowerCase() === normalized,
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `No machine named ${JSON.stringify(machine)} was found`
          : `Machine name ${JSON.stringify(machine)} is ambiguous; use its id`,
      );
    }
    return matches[0]!.id;
  }
  const config = await bb.sdk.system.config();
  const primary = hosts.find((host) => host.id === config.primaryHostId) ?? hosts[0];
  if (primary === undefined) throw new Error("No machine is available");
  return primary.id;
}

function formatSnapshot(snapshot: PiModelSettingsSnapshot): string {
  if (snapshot.models.length === 0) {
    return "No authenticated Pi models are available on this machine.\n";
  }
  const enabled =
    snapshot.enabledModelIds === null ? null : new Set(snapshot.enabledModelIds);
  return `${snapshot.models
    .map(
      (model) =>
        `${enabled === null || enabled.has(model.id) ? "on " : "off"}\t${model.id}\t${model.displayName}`,
    )
    .join("\n")}\n`;
}

/**
 * First-party Pi provider plugin. The declaration is the only source of this
 * provider: disabling this plugin removes the provider. Pi's skill roots are
 * the plugin's fact, not core's: the documented directories are declared,
 * and the ones a host's pi `settings.json` names are resolved on that host
 * by the plugin's `bb.host` entry (`src/native-roots.ts`) when bb lists
 * skills there.
 *
 * Pi's enabled-model preference is host-local too (its `settings.json`
 * `enabledModels`): the plugin edits it through its own bridge RPC on the
 * selected host, from the settings section (`app.tsx`) and `bb pi models`.
 */
export default function plugin(bb: BbPluginApi): void {
  const registered = bb.providers.register(piProviderDeclaration());
  bb.onDispose(() => {
    registered.dispose();
  });

  const bridge = bb.providers.experimental_client({
    providerId: "pi",
    contract: piModelSettingsBridgeContract,
  });
  const read = (hostId: string, signal?: AbortSignal) =>
    bridge.call("model-settings/read", null, {
      hostId,
      ...(signal === undefined ? {} : { signal }),
    });
  const write = async (
    hostId: string,
    enabledModelIds: string[] | null,
    signal?: AbortSignal,
  ) => {
    const snapshot = await bridge.call(
      "model-settings/write",
      { enabledModelIds },
      { hostId, ...(signal === undefined ? {} : { signal }) },
    );
    bb.providers.experimental_modelsChanged({ providerId: "pi", hostId });
    return snapshot;
  };

  bb.rpc.register(piModelSettingsRpcContract, {
    readModelSettings: ({ hostId }) => read(hostId),
    writeModelSettings: ({ hostId, enabledModelIds }) => write(hostId, enabledModelIds),
  });

  bb.cli.register({
    name: "pi",
    summary: "Inspect and configure Pi",
    commands: [
      {
        name: "models",
        summary: "List or replace Pi's enabled models",
        usage:
          "bb pi models [list|set <model-id...>|enable-all] [--machine <id-or-name>] [--json]",
      },
    ],
    async run(argv, context) {
      try {
        const parsed = parseCliArgs(argv);
        const hostId = await resolveHostId(bb, parsed.machine);
        const snapshot =
          parsed.command === "list"
            ? await read(hostId, context.signal)
            : await write(
                hostId,
                parsed.command === "enable-all" ? null : parsed.modelIds,
                context.signal,
              );
        return {
          exitCode: 0,
          stdout: parsed.json ? `${JSON.stringify(snapshot, null, 2)}\n` : formatSnapshot(snapshot),
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
