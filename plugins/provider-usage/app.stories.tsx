import { useState } from "react";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card.js";
import { ProviderUsageStatusContent, type UsageStoreSnapshot } from "./app.js";
import { UsageSettingsContent } from "./settings.js";
import type {
  ProviderUsage,
  UsageMachine,
  UsageProvider,
  UsageSnapshot,
} from "./usage-schema.js";

export default { title: "plugins/Provider usage" };

const codexLogoUrl = new URL(
  "../provider-codex/icons/codex.svg",
  import.meta.url,
).href;
const claudeCodeLogoUrl = new URL(
  "../provider-claude-code/icons/claude-code.svg",
  import.meta.url,
).href;

type ScenarioName =
  | "healthy"
  | "emptyPool"
  | "loading"
  | "offline"
  | "authentication"
  | "missingProvider"
  | "failedRefresh";

function futureIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60_000).toISOString();
}

function provider(
  id: string,
  providerId: string,
  usage: ProviderUsage | null,
): UsageProvider {
  const isClaude = providerId === "claude-code";
  const displayName = isClaude ? "Claude Code" : "Codex";
  return {
    id,
    providerId,
    accountLabel: `${id}@example.com`,
    displayName,
    logoUrl: isClaude ? claudeCodeLogoUrl : codexLogoUrl,
    icon: null,
    strings: {
      iconTint: isClaude ? { light: "#D97757", dark: "#E38A6E" } : null,
    },
    signInHint: "Sign in to this account in the provider’s settings.",
    expiredHint: "Sign in again in the provider’s settings.",
    usage,
  };
}

function measured(
  email: string,
  usedPercent: number,
  planLabel: string,
): ProviderUsage {
  return {
    status: "ok",
    accountEmail: email,
    planLabel,
    windows: [
      {
        label: "Weekly limit",
        usedPercent,
        resetsAt: futureIso(usedPercent > 90 ? 18 : 83),
        cost: null,
      },
    ],
  };
}

function machine(
  id: string,
  displayName: string,
  providers: UsageProvider[],
  overrides: Partial<UsageMachine> = {},
): UsageMachine {
  return {
    id,
    displayName,
    status: "connected",
    providers,
    error: null,
    ...overrides,
  };
}

const healthyPool = machine("source:account-pool", "Account Pooler", [
  provider("alex-codex", "codex", measured("alex@example.com", 28, "Pro")),
  provider("sam-codex", "codex", measured("sam@example.com", 86, "Team")),
  provider(
    "team-claude",
    "claude-code",
    measured("team@example.com", 97, "Max (20x)"),
  ),
]);
const healthyMachine = machine("host-m4", "Michael-M4", [
  provider("local-codex", "codex", measured("local@example.com", 17, "Pro")),
]);

const scenarios: Record<
  Exclude<ScenarioName, "loading">,
  Omit<UsageSnapshot, "hasUsageSources">
> = {
  healthy: { machines: [healthyMachine, healthyPool] },
  emptyPool: {
    machines: [
      healthyMachine,
      machine("source:account-pool", "Account Pooler", []),
    ],
  },
  offline: {
    machines: [
      machine("host-studio", "Studio", [healthyMachine.providers[0]!], {
        status: "disconnected",
      }),
    ],
  },
  authentication: {
    machines: [
      machine("source:account-pool", "Account Pooler", [
        provider("signed-out", "codex", { status: "unauthenticated" }),
        provider("expired", "codex", { status: "expired" }),
      ]),
    ],
  },
  missingProvider: {
    machines: [
      machine("host-m4", "Michael-M4", [
        provider("missing", "codex", { status: "not_installed" }),
      ]),
    ],
  },
  failedRefresh: {
    machines: [
      machine("source:account-pool", "Account Pooler", [
        provider("cached", "codex", measured("cached@example.com", 64, "Pro")),
      ]),
    ],
  },
};

function storySnapshot(name: ScenarioName): UsageStoreSnapshot {
  if (name === "loading") {
    return { data: null, error: null, isRefreshing: true };
  }
  return {
    data: { ...scenarios[name], hasUsageSources: true },
    error: name === "failedRefresh" ? "Couldn’t refresh usage." : null,
    isRefreshing: false,
  };
}

function SettingsPreview({ scenario }: { scenario: ScenarioName }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const machines = scenario === "loading" ? [] : scenarios[scenario].machines;
  return (
    <div className="min-h-56 w-full max-w-3xl rounded-lg bg-background p-5">
      <UsageSettingsContent
        machines={machines}
        selectedId={selectedId}
        loading={scenario === "loading"}
        error={scenario === "failedRefresh"}
        hasUsageSources={scenario !== "loading"}
        onSelect={setSelectedId}
        onRefresh={() => {}}
      />
    </div>
  );
}

function FooterPreview({ scenario }: { scenario: ScenarioName }) {
  return (
    <div className="w-[303px] overflow-hidden rounded-xl border border-sidebar-border bg-sidebar text-sidebar-foreground">
      <ProviderUsageStatusContent
        dismiss={() => {}}
        snapshot={storySnapshot(scenario)}
        threadMachineId={null}
        refreshEnabled={false}
      />
    </div>
  );
}

const descriptions: Record<ScenarioName, string> = {
  healthy: "Multiple pooled accounts with provider grouping and quota badges.",
  emptyPool: "Account Pooler is enabled and selectable but has no accounts.",
  loading: "The initial usage request has not completed.",
  offline: "The selected persistent machine is currently disconnected.",
  authentication: "Signed-out and expired accounts remain distinct.",
  missingProvider: "The selected machine does not have the provider installed.",
  failedRefresh:
    "The latest refresh failed while cached measurements remain visible.",
};

const storyRows: readonly { label: string; scenario: ScenarioName }[] = [
  { label: "healthy", scenario: "healthy" },
  { label: "empty account pool", scenario: "emptyPool" },
  { label: "loading", scenario: "loading" },
  { label: "offline machine", scenario: "offline" },
  { label: "authentication", scenario: "authentication" },
  { label: "missing provider", scenario: "missingProvider" },
  { label: "failed refresh", scenario: "failedRefresh" },
];

export function Settings() {
  return (
    <StoryCard labelWidth="180px">
      {storyRows.map(({ label, scenario }) => (
        <StoryRow key={scenario} label={label} hint={descriptions[scenario]}>
          <SettingsPreview scenario={scenario} />
        </StoryRow>
      ))}
    </StoryCard>
  );
}

export function Disclosure() {
  return (
    <StoryCard labelWidth="180px">
      {storyRows.map(({ label, scenario }) => (
        <StoryRow key={scenario} label={label} hint={descriptions[scenario]}>
          <FooterPreview scenario={scenario} />
        </StoryRow>
      ))}
    </StoryCard>
  );
}
