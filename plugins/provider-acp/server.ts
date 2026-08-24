/**
 * The ACP providers plugin.
 *
 * The plugin owns its agents: the list bb ships knowledge of, and the ones a
 * user configures in this plugin's own settings. Both become registrations
 * here, at runtime, and a settings change re-registers without a restart —
 * one plugin, N providers, no core table of ACP agents anywhere.
 *
 * The host side (`src/host.ts`) re-exports the published kit's bridge and
 * adds one RPC that asks an agent what it supports, so this file is the whole
 * of bb's ACP privilege: a list of agents anyone could have written.
 */

import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { type AcpAgentDefinition } from "./src/agents.js";
import { resolveConfiguredAcpAgents } from "./src/configured-agents.js";
import { acpHostContract, type AcpProbeResult } from "./src/contract.js";
import { acpProviderDeclaration } from "./src/declaration.js";
import { applyAcpAgentProbe } from "./src/probe-capabilities.js";
import {
  KNOWN_ACP_AGENTS,
  RESERVED_ACP_PROVIDER_IDS,
} from "./src/known-agents.js";
import { readLegacyCustomAcpAgents } from "./src/legacy-config.js";

/**
 * Two sentences on purpose: the settings page shows this beside a multi-line
 * JSON editor, and the field reference (the optional fields, the replacement
 * rule for a shipped agent's id, the `acp-<id>` provider id) is the "Custom
 * ACP Agents" chapter of docs/configuration.md.
 */
const CUSTOM_AGENTS_SETTING_DESCRIPTION =
  "A JSON array of ACP agents to add. Each entry needs id, displayName and command; see the guide for the optional fields.";

/**
 * The shipped agents a probe could change. `applyAcpAgentProbe` only ever
 * narrows a declared `fork`, so an agent that declares `"none"` — every
 * configured agent, and cursor and grok — has no answer worth spawning it
 * for.
 */
const PROBEABLE_ACP_AGENTS = KNOWN_ACP_AGENTS.filter(
  (agent) => (agent.fork ?? "none") !== "none",
);

/**
 * How often the probe service looks for a host that has connected since the
 * last look. Plugins load as soon as the server is listening, while daemons
 * reconnect on a 1s-30s backoff, so the answer at factory time is usually
 * "no hosts at all".
 */
const HOST_POLL_INTERVAL_MS = 5_000;

/**
 * Sleep, cut short by an abort.
 *
 * The listener is removed on BOTH paths. A service that polls for the life of
 * the plugin adds one listener per iteration, and `{ once: true }` only
 * removes it when the event actually fires — so a listener per poll accretes
 * on a signal that is aborted once, at dispose.
 */
async function sleepUntilAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}

export default async function acpProvidersPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const host = bb.hosts.experimental_client({ contract: acpHostContract });
  const settings = bb.settings.define({
    customAgents: {
      type: "string",
      label: "Custom agents",
      description: CUSTOM_AGENTS_SETTING_DESCRIPTION,
      experimental_multiline: true,
      default: "",
    },
  });

  /**
   * What is registered, keyed by provider id, with the declaration it was
   * registered from. Reconciling against this instead of disposing everything
   * matters twice: re-registering an id gives it a new sequence in the
   * registry, which moves it to the end of the picker's ACP group, and a
   * partial failure must not leave a registration nobody holds a disposer
   * for.
   */
  const registered = new Map<string, { key: string; dispose(): void }>();

  /**
   * Shipped agents a probe narrowed, keyed by provider id, and the configured
   * list from the last settings read. Both outlive one pass: a settings save
   * must not resurrect a `fork` a host already denied, and a probe must not
   * drop the agents the setting added.
   */
  const narrowed = new Map<string, AcpAgentDefinition>();
  let configuredAgents: readonly AcpAgentDefinition[] = [];

  /**
   * The agents this plugin should have registered right now: the shipped
   * list as any probe narrowed it, minus the agents a configured entry
   * replaces, plus the configured ones.
   */
  function desiredAgents(): AcpAgentDefinition[] {
    const configuredIds = new Set(
      configuredAgents.map((agent) => agent.id),
    );
    return [
      ...KNOWN_ACP_AGENTS.filter((agent) => !configuredIds.has(agent.id)).map(
        (agent) => narrowed.get(agent.id) ?? agent,
      ),
      ...configuredAgents,
    ];
  }

  function register(declaration: PluginProviderDeclaration): void {
    try {
      const { dispose } = bb.providers.register(declaration);
      registered.set(declaration.id, {
        key: JSON.stringify(declaration),
        dispose,
      });
    } catch (error) {
      // One bad agent must not cost the user the rest of the list.
      bb.log.error(
        `Could not register ACP provider "${declaration.id}": ${String(error)}`,
      );
    }
  }

  function reconcile(agents: readonly AcpAgentDefinition[]): void {
    const desired = new Map(
      agents.map((agent) => [agent.id, acpProviderDeclaration(agent)]),
    );
    for (const [id, entry] of [...registered]) {
      const next = desired.get(id);
      if (next !== undefined && JSON.stringify(next) === entry.key) {
        continue;
      }
      entry.dispose();
      registered.delete(id);
    }
    for (const [id, declaration] of desired) {
      if (registered.has(id)) {
        continue;
      }
      register(declaration);
    }
  }

  async function resolveAndReconcile(settingValue: string): Promise<void> {
    const legacy = await readLegacyCustomAcpAgents(
      bb.server.experimental_dataDir,
    );
    const resolved = resolveConfiguredAcpAgents({
      settingValue,
      legacyEntries: legacy.entries,
      ...(legacy.problem === undefined ? {} : { legacyProblem: legacy.problem }),
      reservedProviderIds: RESERVED_ACP_PROVIDER_IDS,
      shippedAgents: KNOWN_ACP_AGENTS,
    });
    for (const warning of resolved.warnings) {
      bb.log.warn(warning);
    }
    configuredAgents = resolved.agents;
    reconcile(desiredAgents());
    if (resolved.agents.length > 0) {
      bb.log.info(
        `Registered ${resolved.agents.length} configured ACP agent(s).`,
      );
    }
  }

  /**
   * Settings writes are serialized. Each pass disposes and re-registers, and
   * two overlapping passes would collide on an id one of them had already
   * taken — leaving registrations the plugin no longer holds a disposer for,
   * which poisons every later pass until the plugin reloads.
   */
  let pending: Promise<void> = Promise.resolve();
  function queueReconcile(settingValue: string): Promise<void> {
    pending = pending
      .catch(() => undefined)
      .then(() => resolveAndReconcile(settingValue));
    return pending;
  }

  /**
   * Ask each agent that could be narrowed what it supports, and re-register
   * the ones whose answer differs from what bb declared. A host that cannot
   * be reached, or an agent that is not installed there, leaves the
   * declaration alone: bb narrows a capability it can verify and never widens
   * one it cannot.
   *
   * Only a `fork: "tip"` agent can change (`applyAcpAgentProbe`), so only
   * those are spawned. Probing the rest would launch every configured agent
   * on every host, with a 10s budget each, for an outcome that cannot happen.
   */
  async function probeAgents(hostId: string, signal: AbortSignal): Promise<void> {
    const configuredIds = new Set(configuredAgents.map((agent) => agent.id));
    for (const shipped of PROBEABLE_ACP_AGENTS) {
      if (signal.aborted) return;
      // A configured entry replaced this agent; bb's declaration for it is
      // gone, so there is nothing to narrow.
      if (configuredIds.has(shipped.id)) continue;
      const agent = narrowed.get(shipped.id) ?? shipped;
      // Already narrowed to the floor on an earlier host. The rule only ever
      // narrows, so no answer from any host can move it again — spawning the
      // agent on the next host that connects buys nothing.
      if ((agent.fork ?? "none") === "none") continue;
      let probe: AcpProbeResult;
      try {
        probe = await host.call(
          "probeAgent",
          {
            command: agent.launch.command,
            args: agent.launch.args,
            env: agent.launch.env,
          },
          { hostId, signal },
        );
      } catch (error) {
        bb.log.debug(
          `Could not probe ${agent.id} on host ${hostId}: ${String(error)}`,
        );
        continue;
      }
      const applied = applyAcpAgentProbe(agent, probe);
      if (applied === null) {
        continue;
      }
      bb.log.info(
        `${agent.id} on host ${hostId}: ${applied.reason}; re-registering.`,
      );
      narrowed.set(agent.id, applied.agent);
      reconcile(desiredAgents());
    }
  }

  // The shipped agents register before the first await: reading the setting
  // and the deprecated config file is IO, and bb's own list must not wait on
  // it. A configured entry that replaces one of them is applied by the first
  // reconcile, a moment later.
  for (const agent of desiredAgents()) {
    register(acpProviderDeclaration(agent));
  }

  const initial = await settings.get();
  await queueReconcile(initial.customAgents);
  settings.onChange((next) => {
    void queueReconcile(next.customAgents).catch((error: unknown) => {
      bb.log.error(
        `Could not re-register the configured ACP agents: ${String(error)}`,
      );
    });
  });

  /**
   * One probe pass per host CONNECTION, not one at factory time. Plugins load
   * immediately after the server starts listening, so the factory-time answer
   * is "every host is disconnected" and nothing would ever narrow; a host
   * that drops and returns is probed again, because a reconnect can be a
   * different machine state.
   *
   * A background service rather than a worker-exit handler: the daemon
   * reports a worker that fails to start as an unexpected exit, so re-probing
   * from that event turns a deterministic worker failure into an unbounded
   * restart loop.
   */
  bb.background.service("acp-capability-probe", {
    async start(signal: AbortSignal): Promise<void> {
      const probed = new Set<string>();
      while (!signal.aborted) {
        const hosts = await bb.sdk.hosts.list();
        const connected = new Set(
          hosts
            .filter((available) => available.status === "connected")
            .map((available) => available.id),
        );
        for (const hostId of [...probed]) {
          if (!connected.has(hostId)) probed.delete(hostId);
        }
        for (const hostId of connected) {
          if (signal.aborted || probed.has(hostId)) continue;
          probed.add(hostId);
          await probeAgents(hostId, signal);
        }
        if (signal.aborted) break;
        await sleepUntilAbort(HOST_POLL_INTERVAL_MS, signal);
      }
    },
  });

  bb.onDispose(() => {
    for (const [, entry] of registered) {
      entry.dispose();
    }
    registered.clear();
  });
}
