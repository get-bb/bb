import type { ProviderRetryPhase, ProviderRetryView } from "./src/contract.js";
import {
  ProviderRetryBannerView,
  type ProviderRetryBannerAction,
} from "./banner.js";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card";

export default {
  title: "plugins/Provider retry banners",
};

const RESET_AT_MS = Date.parse("2026-08-07T19:00:00.000Z");
const DUE_AT_MS = RESET_AT_MS + 30_000;

function providerRetryView(
  overrides: Partial<ProviderRetryView> = {},
): ProviderRetryView {
  return {
    threadId: "thr_provider_retry_audit",
    failedRequestId: "req_provider_retry_audit",
    scopeKey: "host-audit:claude-code",
    hostId: "host-audit",
    providerId: "claude-code",
    phase: "waiting-for-reset",
    automatic: true,
    dueAtMs: DUE_AT_MS,
    resetsAtMs: RESET_AT_MS,
    windowLabel: "Five-hour",
    kind: "subscription-window",
    reachedReason: "rate_limit_reached",
    overageReason: null,
    recoveryReason: "eligible",
    continuationError: null,
    refreshError: null,
    ...overrides,
  };
}

interface BannerAuditCase {
  hint: string;
  label: string;
  view: ProviderRetryView;
}

const PHASE_CASES = {
  "waiting-for-reset": {
    label: "Waiting for reset",
    hint: "Safe turn with an automatic continuation scheduled.",
    view: providerRetryView(),
  },
  "manual-only": {
    label: "Beyond maximum wait",
    hint: "Reset exists, but it exceeds the configured automatic horizon.",
    view: providerRetryView({
      providerId: "codex",
      scopeKey: "host-audit:codex",
      phase: "manual-only",
      automatic: false,
      dueAtMs: null,
      windowLabel: "Seven-day",
      recoveryReason: "manual-only",
    }),
  },
  "waiting-for-host": {
    label: "Host disconnected",
    hint: "The reset passed, but bb cannot reach the thread's host.",
    view: providerRetryView({
      phase: "waiting-for-host",
      dueAtMs: null,
      recoveryReason: "host-offline",
    }),
  },
  releasing: {
    label: "Continuing",
    hint: "Automatic continuation is currently starting.",
    view: providerRetryView({
      phase: "releasing",
      dueAtMs: null,
      recoveryReason: "eligible",
    }),
  },
  "retry-failed": {
    label: "Continuation failed",
    hint: "The reset passed, but the guarded continuation could not start.",
    view: providerRetryView({
      phase: "retry-failed",
      dueAtMs: null,
      recoveryReason: "continuation-failed",
      continuationError: "This thread is awaiting user interaction",
    }),
  },
  blocked: {
    label: "No reset time",
    hint: "Credits or spend controls cannot be scheduled automatically.",
    view: providerRetryView({
      phase: "blocked",
      automatic: false,
      dueAtMs: null,
      resetsAtMs: null,
      windowLabel: null,
      kind: "credits",
      reachedReason: "insufficient_credits",
      recoveryReason: "no-reset-time",
    }),
  },
  unsafe: {
    label: "Unsafe to continue",
    hint: "The rejected turn may already have produced output or side effects.",
    view: providerRetryView({
      phase: "unsafe",
      automatic: false,
      dueAtMs: null,
      recoveryReason: "possible-side-effects",
      windowLabel: "Fable",
    }),
  },
} satisfies Record<ProviderRetryPhase, BannerAuditCase>;

interface BannerPresentationCase extends BannerAuditCase {
  actionError?: string | null;
  busy?: ProviderRetryBannerAction | null;
}

const PRESENTATION_CASES: readonly BannerPresentationCase[] = [
  {
    label: "Spend control",
    hint: "The other non-resetting account limit kind.",
    view: providerRetryView({
      phase: "blocked",
      automatic: false,
      dueAtMs: null,
      resetsAtMs: null,
      windowLabel: null,
      kind: "spend-control",
      reachedReason: null,
      overageReason: "monthly_budget_reached",
      recoveryReason: "no-reset-time",
    }),
  },
  {
    label: "Refresh unavailable",
    hint: "Live provider usage could not be read.",
    view: providerRetryView({
      refreshError: "Claude Code usage is temporarily unavailable",
    }),
  },
  {
    label: "Action failed",
    hint: "A manual action lost a race or failed at the server boundary.",
    actionError: "This continuation is already in progress.",
    view: providerRetryView(),
  },
  {
    label: "Refreshing",
    hint: "Transient Refresh button state.",
    busy: "refresh",
    view: providerRetryView(),
  },
  {
    label: "Continuing manually",
    hint: "Transient Retry now button state.",
    busy: "now",
    view: providerRetryView(),
  },
  {
    label: "Cancelling",
    hint: "Transient Cancel button state.",
    busy: "cancel",
    view: providerRetryView(),
  },
];

function BannerRows({ cases }: { cases: readonly BannerPresentationCase[] }) {
  return cases.map(({ actionError = null, busy = null, hint, label, view }) => (
    <StoryRow key={label} label={label} hint={hint}>
      <div className="w-full max-w-2xl">
        <ProviderRetryBannerView
          actionError={actionError}
          busy={busy}
          onAction={() => undefined}
          view={view}
        />
      </div>
    </StoryRow>
  ));
}

export function AllBanners() {
  return (
    <main className="mx-auto w-full max-w-6xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Recovery phases
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every durable phase in the provider-retry banner contract. This list
            is compile-time exhaustive.
          </p>
        </div>
        <BannerRows cases={Object.values(PHASE_CASES)} />
      </StoryCard>

      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Errors and transient actions
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Additional user-facing copy and pending button states layered onto
            the recovery phases.
          </p>
        </div>
        <BannerRows cases={PRESENTATION_CASES} />
      </StoryCard>
    </main>
  );
}
