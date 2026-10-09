import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ACP_REGISTRY_URL,
  describeRegistryAgents,
  parseAcpRegistry,
  settingWithRegistryAgent,
  settingWithoutAgent,
  type AcpRegistryAgent,
  type AcpRegistryAgentView,
} from "./registry.js";

const REGISTRY_CACHE_KEY = "registry";
const REGISTRY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REGISTRY_FETCH_TIMEOUT_MS = 15_000;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const registryAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  repository: z.string().nullable(),
  website: z.string().nullable(),
  authors: z.array(z.string()),
  license: z.string().nullable(),
  launch: z
    .object({
      kind: z.enum(["npx", "uvx"]),
      package: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    })
    .nullable(),
  binaryPlatforms: z.array(z.string()),
});

const registryAgentViewSchema = registryAgentSchema.extend({
  providerId: z.string(),
  status: z.enum([
    "available",
    "added",
    "update-available",
    "built-in",
    "manual-install",
  ]),
  command: z.string().nullable(),
});

const registryViewSchema = z.object({
  fetchedAt: z.number().nullable(),
  error: z.string().nullable(),
  agents: z.array(registryAgentViewSchema),
});
export type AcpRegistryView = z.infer<typeof registryViewSchema>;

const agentIdInputSchema = z.object({ id: z.string().min(1) }).strict();

export const acpRegistryRpcContract = defineRpcContract({
  listRegistry: {
    input: z.object({ refresh: z.boolean() }).strict(),
    output: registryViewSchema,
  },
  addRegistryAgent: { input: agentIdInputSchema, output: registryViewSchema },
  removeAgent: { input: agentIdInputSchema, output: registryViewSchema },
});

const cachedRegistrySchema = z.object({
  fetchedAt: z.number(),
  agents: z.array(registryAgentSchema),
});

interface LoadedRegistry {
  agents: AcpRegistryAgent[];
  fetchedAt: number | null;
  error: string | null;
}

interface AcpRegistryServiceDeps {
  bb: Pick<BbPluginApi, "storage" | "rpc" | "cli" | "log">;
  readCustomAgents(): Promise<string>;
  writeCustomAgents(value: string): Promise<void>;
  reservedProviderIds: ReadonlySet<string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchRegistryDocument(): Promise<unknown> {
  const response = await fetch(ACP_REGISTRY_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`The ACP registry answered ${response.status}.`);
  }
  return response.json();
}

const STATUS_LABELS: Record<AcpRegistryAgentView["status"], string> = {
  available: "available",
  added: "added",
  "update-available": "update available",
  "built-in": "built in",
  "manual-install": "manual install",
};

export function formatRegistryView(view: AcpRegistryView): string {
  const lines = view.agents.map(
    (agent) =>
      `${agent.id}  ${agent.name} ${agent.version}  [${STATUS_LABELS[agent.status]}]${
        agent.description === "" ? "" : `  ${agent.description}`
      }`,
  );
  if (view.error !== null) {
    lines.push(
      view.agents.length === 0
        ? `Could not load the ACP registry: ${view.error}`
        : `Showing a saved copy; the ACP registry could not be reached: ${view.error}`,
    );
  } else if (lines.length === 0) {
    lines.push("The ACP registry lists no agents.");
  }
  return lines.join("\n");
}

export function registerAcpRegistry(deps: AcpRegistryServiceDeps): void {
  const { bb } = deps;

  async function readCache(): Promise<{
    fetchedAt: number;
    agents: AcpRegistryAgent[];
  } | null> {
    const cached = cachedRegistrySchema.safeParse(
      await bb.storage.kv.get<unknown>(REGISTRY_CACHE_KEY),
    );
    return cached.success ? cached.data : null;
  }

  async function loadRegistry(refresh: boolean): Promise<LoadedRegistry> {
    const cached = await readCache();
    if (
      cached !== null &&
      !refresh &&
      Date.now() - cached.fetchedAt < REGISTRY_CACHE_TTL_MS
    ) {
      return { ...cached, error: null };
    }
    try {
      const parsed = parseAcpRegistry(await fetchRegistryDocument());
      const fetchedAt = Date.now();
      await bb.storage.kv.set(REGISTRY_CACHE_KEY, {
        fetchedAt,
        agents: parsed.agents,
      });
      if (parsed.skipped > 0) {
        bb.log.debug(
          `Skipped ${parsed.skipped} ACP registry entries bb could not read.`,
        );
      }
      return { agents: parsed.agents, fetchedAt, error: null };
    } catch (error) {
      return {
        agents: cached?.agents ?? [],
        fetchedAt: cached?.fetchedAt ?? null,
        error: errorMessage(error),
      };
    }
  }

  async function view(refresh: boolean): Promise<AcpRegistryView> {
    const loaded = await loadRegistry(refresh);
    return {
      fetchedAt: loaded.fetchedAt,
      error: loaded.error,
      agents: describeRegistryAgents({
        agents: loaded.agents,
        settingValue: await deps.readCustomAgents(),
        reservedProviderIds: deps.reservedProviderIds,
      }),
    };
  }

  async function addAgent(id: string): Promise<AcpRegistryView> {
    const loaded = await loadRegistry(false);
    const agent = loaded.agents.find((candidate) => candidate.id === id);
    if (agent === undefined) {
      throw new Error(
        loaded.error === null
          ? `The ACP registry has no agent "${id}".`
          : `The ACP registry could not be loaded: ${loaded.error}`,
      );
    }
    if (deps.reservedProviderIds.has(`acp-${id}`)) {
      throw new Error(`${agent.name} is already built into bb.`);
    }
    await deps.writeCustomAgents(
      settingWithRegistryAgent(await deps.readCustomAgents(), agent),
    );
    return view(false);
  }

  async function removeAgent(id: string): Promise<AcpRegistryView> {
    await deps.writeCustomAgents(
      settingWithoutAgent(await deps.readCustomAgents(), id),
    );
    return view(false);
  }

  bb.rpc.register(acpRegistryRpcContract, {
    listRegistry: ({ refresh }) => view(refresh),
    addRegistryAgent: ({ id }) => addAgent(id),
    removeAgent: ({ id }) => removeAgent(id),
  });

  async function changeAgents(
    change: () => Promise<AcpRegistryView>,
    describe: (view: AcpRegistryView) => string,
    json: boolean,
  ): Promise<{ exitCode: number; stdout: string }> {
    let next: AcpRegistryView;
    try {
      next = await change();
    } catch (error) {
      throw new PluginCliError(errorMessage(error), {
        code: "acp_agent_change_failed",
        hint: "Run `bb acp registry` to see the agents and their ids.",
      });
    }
    return {
      exitCode: 0,
      stdout: json ? JSON.stringify(next) : describe(next),
    };
  }

  bb.cli.register(
    defineCli({
      name: "acp",
      summary: "Add ACP agents from the official registry",
      description:
        "Lists the agents in the Agent Client Protocol registry and adds them to bb as providers. Added agents run through npx or uvx on the machine that hosts the thread.",
      commands: {
        registry: cliCommand({
          summary: "List the registry's agents and whether each is added to bb",
          options: {
            refresh: {
              type: "boolean",
              description:
                "Fetch the registry again instead of using the saved copy",
            },
            json: JSON_OPTION,
          },
          async run(input) {
            const current = await view(input.options.refresh);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(current)
                : formatRegistryView(current),
            };
          },
        }),
        add: cliCommand({
          summary:
            "Add a registry agent as a bb provider, or move an added one to the registry's current version",
          positionals: [
            {
              name: "agent-id",
              description: "The agent's registry id",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) => {
            const id = input.positionals["agent-id"];
            return changeAgents(
              () => addAgent(id),
              (next) => {
                const added = next.agents.find((agent) => agent.id === id);
                return added === undefined
                  ? `Added ${id}`
                  : `Added ${added.name} ${added.version} as provider ${added.providerId}\nRuns: ${added.command ?? ""}`;
              },
              input.options.json,
            );
          },
        }),
        remove: cliCommand({
          summary:
            "Remove an agent that was added from the registry or by hand",
          positionals: [
            {
              name: "agent-id",
              description: "The configured agent's id",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) => {
            const id = input.positionals["agent-id"];
            return changeAgents(
              () => removeAgent(id),
              () => `Removed ${id}`,
              input.options.json,
            );
          },
        }),
      },
    }),
  );
}
