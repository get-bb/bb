import type { ProviderCliKey, ProviderUsage } from "@bb/host-daemon-contract";
import type {
  OnboardingAgent,
  OnboardingAgentOverview,
  SystemProvidersQuery,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import {
  KNOWN_ACP_AGENTS,
  listKnownAcpAgentExecutableQueries,
} from "./known-acp-agents.js";

/**
 * Onboarding's view of the machine.
 *
 * Three host signals are assembled here rather than in the client, because the
 * daemon returns raw host facts and the server owns product policy:
 *
 * - `provider.usage` — plan + account + auth state, and only for Codex, Claude
 *   Code, and Cursor. Those are the only three that can report a plan.
 * - `provider_cli.status` — install state for the same three, plus the managed
 *   installer that makes "Install" possible at all.
 * - `known_acp_agents.status` — presence of opencode, omp, Grok Build, and
 *   Hermes Agent. Real, usable providers with no billing detail; they get no
 *   plan badge rather than a fabricated one.
 */

interface PlanCapableAgentConfig {
  cliKey: ProviderCliKey;
  loginCommand: string;
}

/**
 * The three plan-capable CLIs, ordered by the same provider registry that
 * drives the model picker's provider tabs.
 */
const PLAN_CAPABLE_BY_PROVIDER_ID = new Map<string, PlanCapableAgentConfig>([
  [
    "codex",
    {
      cliKey: "codex",
      loginCommand: "codex login",
    },
  ],
  [
    "claude-code",
    {
      cliKey: "claudeCode",
      loginCommand: "claude /login",
    },
  ],
  [
    "acp-cursor",
    {
      cliKey: "cursor",
      loginCommand: "cursor-agent login",
    },
  ],
]);

function listPlanCapableAgents(deps: Pick<AppDeps, "providerRegistry">) {
  return deps.providerRegistry.list().flatMap((entry) => {
    const config = PLAN_CAPABLE_BY_PROVIDER_ID.get(entry.info.id);
    return config === undefined
      ? []
      : [
          {
            ...config,
            providerId: entry.info.id,
            displayName: entry.info.displayName,
          },
        ];
  });
}

/**
 * Collapse a `ProviderUsage` and its CLI install state into the single status
 * onboarding renders. `error` is deliberately folded into `connected`: the CLI
 * is installed and authenticated, we just could not reach the usage API, and
 * onboarding must not tell someone to sign in again over a network blip.
 */
function resolveStatus(
  usage: ProviderUsage | undefined,
  installed: boolean,
): OnboardingAgent["status"] {
  if (!installed) return "not_installed";
  // No usage result at all means the probe never reached the daemon. That is
  // not evidence of a working login, so it must not read as connected — the
  // step would let the user continue onto an agent that cannot run.
  if (usage === undefined) return "unauthenticated";
  switch (usage.status) {
    case "ok":
      return "connected";
    case "unauthenticated":
      return "unauthenticated";
    case "expired":
      return "expired";
    case "not_installed":
      // The usage probe disagrees with the CLI health check (different lookup
      // paths). Trust the health check, which is what install acts on.
      return "unauthenticated";
    default:
      // `error` only: the CLI is installed and authenticated, we just could not
      // read usage. Telling the user to sign in again over a network blip would
      // be worse than showing them connected.
      return "connected";
  }
}

export async function getOnboardingAgentOverview(
  deps: AppDeps,
  query: SystemProvidersQuery,
): Promise<OnboardingAgentOverview> {
  const hostId = resolveSystemLookupHostId(deps, query);

  const rpc = { hostId, timeoutMs: COMMAND_TIMEOUT_MS } as const;

  // One slow or failing probe must not blank the whole screen: each source
  // degrades to "nothing known" independently.
  const [usage, cliStatus, acpStatus] = await Promise.all([
    callHostRetryableOnlineRpc(deps, {
      ...rpc,
      command: { type: "provider.usage" },
    }).catch(() => null),
    callHostRetryableOnlineRpc(deps, {
      ...rpc,
      command: { type: "provider_cli.status" },
    }).catch(() => null),
    callHostRetryableOnlineRpc(deps, {
      ...rpc,
      command: {
        type: "known_acp_agents.status",
        agents: listKnownAcpAgentExecutableQueries(),
      },
    }).catch(() => null),
  ]);

  const agents: OnboardingAgent[] = [];

  for (const entry of listPlanCapableAgents(deps)) {
    const providerUsage = usage?.[entry.cliKey];
    const installed = cliStatus?.[entry.cliKey]?.installed ?? false;
    const status = resolveStatus(providerUsage, installed);
    agents.push({
      providerId: entry.providerId,
      displayName: entry.displayName,
      status,
      // `error` still carries plan/account when they were readable from local
      // credentials — a rate-limited usage API must not blank the plan bb
      // already knows pays for inference.
      planLabel:
        providerUsage?.status === "ok" || providerUsage?.status === "error"
          ? providerUsage.planLabel
          : null,
      accountEmail:
        providerUsage?.status === "ok" || providerUsage?.status === "error"
          ? providerUsage.accountEmail
          : null,
      // Only these three have a managed installer, so only these may be offered.
      canInstall: true,
      loginCommand: entry.loginCommand,
    });
  }

  const acpInstalled = new Set(
    (acpStatus?.agents ?? [])
      .filter((agent) => agent.installed)
      .map((agent) => agent.id),
  );
  for (const agent of KNOWN_ACP_AGENTS) {
    if (!acpInstalled.has(agent.id)) continue;
    agents.push({
      providerId: agent.id,
      displayName: agent.displayName,
      // Presence is all we know. bb launches these over ACP, which handles auth
      // itself, so an installed ACP agent is usable.
      status: "connected",
      planLabel: null,
      accountEmail: null,
      canInstall: false,
      // ACP agents authenticate through the bridge, not a bb-visible command.
      loginCommand: null,
    });
  }

  return { agents };
}
