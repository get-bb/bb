import { useState, type ReactNode } from "react";
import { ProviderUsageStatusContent, type UsageStoreSnapshot } from "./app.js";
import { UsageSettingsContent } from "./settings.js";
import type {
  ProviderUsage,
  UsageMachine,
  UsageProvider,
  UsageSnapshot,
} from "./usage-schema.js";

export default { title: "plugins/Provider usage" };

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const codexLogoUrl = svgDataUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
);
const claudeCodeLogoUrl = svgDataUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 149 149" fill="currentColor"><path d="M29.05 98.54L58.19 82.19L58.68 80.77L58.19 79.98H56.77L51.9 79.68L35.25 79.23L20.81 78.63L6.82 77.88L3.3 77.13L0 72.78L0.340004 70.61L3.3 68.62L7.54 68.99L16.91 69.63L30.97 70.6L41.17 71.2L56.28 72.77H58.68L59.02 71.8L58.2 71.2L57.56 70.6L43.01 60.74L27.26 50.32L19.01 44.32L14.55 41.28L12.3 38.43L11.33 32.21L15.38 27.75L20.82 28.12L22.21 28.49L27.72 32.73L39.49 41.84L54.86 53.16L57.11 55.03L58.01 54.39L58.12 53.94L57.11 52.25L48.75 37.14L39.83 21.77L35.86 15.4L34.81 11.58C34.44 10.01 34.17 8.69 34.17 7.08L38.78 0.820007L41.33 0L47.48 0.820007L50.07 3.07001L53.89 11.81L60.08 25.57L69.68 44.28L72.49 49.83L73.99 54.97L74.55 56.54H75.52V55.64L76.31 45.1L77.77 32.16L79.19 15.51L79.68 10.82L82 5.2L86.61 2.16L90.21 3.88L93.17 8.12L92.76 10.86L91 22.3L87.55 40.22L85.3 52.22H86.61L88.11 50.72L94.18 42.66L104.38 29.91L108.88 24.85L114.13 19.26L117.5 16.6H123.87L128.56 23.57L126.46 30.77L119.9 39.09L114.46 46.14L106.66 56.64L101.79 65.04L102.24 65.71L103.4 65.6L121.02 61.85L130.54 60.13L141.9 58.18L147.04 60.58L147.6 63.02L145.58 68.01L133.43 71.01L119.18 73.86L97.96 78.88L97.7 79.07L98 79.44L107.56 80.34L111.65 80.56H121.66L140.3 81.95L145.17 85.17L148.09 89.11L147.6 92.11L140.1 95.93L129.98 93.53L106.36 87.91L98.26 85.89H97.14V86.56L103.89 93.16L116.26 104.33L131.75 118.73L132.54 122.29L130.55 125.1L128.45 124.8L114.84 114.56L109.59 109.95L97.7 99.94H96.91V100.99L99.65 105L114.12 126.75L114.87 133.42L113.82 135.59L110.07 136.9L105.95 136.15L97.48 124.26L88.74 110.87L81.69 98.87L80.83 99.36L76.67 144.17L74.72 146.46L70.22 148.18L66.47 145.33L64.48 140.72L66.47 131.61L68.87 119.72L70.82 110.27L72.58 98.53L73.63 94.63L73.56 94.37L72.7 94.48L63.85 106.63L50.39 124.82L39.74 136.22L37.19 137.23L32.77 134.94L33.18 130.85L35.65 127.21L50.39 108.46L59.28 96.84L65.02 90.13L64.98 89.16H64.64L25.49 114.58L18.52 115.48L15.52 112.67L15.89 108.06L17.31 106.56L29.08 98.46L29.04 98.5L29.05 98.54Z"/></svg>',
);

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

const scenarios: Record<Exclude<ScenarioName, "loading">, UsageSnapshot> = {
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
    data: scenarios[name],
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

function ScenarioRows({
  children,
}: {
  children: (scenario: ScenarioName) => ReactNode;
}) {
  return (
    <div className="m-6 flex flex-col rounded-md">
      {storyRows.map(({ label, scenario }) => (
        <div
          key={scenario}
          className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-x-4 px-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-xs break-words text-muted-foreground">
              {descriptions[scenario]}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {children(scenario)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Settings() {
  return (
    <ScenarioRows>
      {(scenario) => <SettingsPreview scenario={scenario} />}
    </ScenarioRows>
  );
}

export function Disclosure() {
  return (
    <ScenarioRows>
      {(scenario) => <FooterPreview scenario={scenario} />}
    </ScenarioRows>
  );
}
