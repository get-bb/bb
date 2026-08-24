import type { ProviderRetryView } from "./src/contract.js";
import { ProviderRetryBannerView } from "./banner.js";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card";

export default {
  title: "plugins/Provider retry banners",
};

const RETRY_AT_MS = Date.parse("2026-08-07T19:00:30.000Z");

const CASES: readonly {
  hint: string;
  label: string;
  view: ProviderRetryView;
  widthClassName: string;
}[] = [
  {
    label: "With retry time",
    hint: "The provider reported an exact reset time.",
    widthClassName: "max-w-2xl",
    view: {
      threadId: "thr_provider_retry_audit",
      providerId: "claude-code",
      retryAtMs: RETRY_AT_MS,
    },
  },
  {
    label: "Without retry time",
    hint: "An automatic retry is still pending without an exact time.",
    widthClassName: "max-w-2xl",
    view: {
      threadId: "thr_provider_retry_audit",
      providerId: "codex",
      retryAtMs: null,
    },
  },
  {
    label: "Narrow composer",
    hint: "The full message wraps while Cancel remains pinned to the right.",
    widthClassName: "max-w-xs",
    view: {
      threadId: "thr_provider_retry_audit",
      providerId: "claude-code",
      retryAtMs: RETRY_AT_MS,
    },
  },
];

export function AllBanners() {
  return (
    <main className="mx-auto w-full max-w-6xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Provider retry
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The banner is shown only while an automatic retry is pending.
          </p>
        </div>
        {CASES.map(({ hint, label, view, widthClassName }) => (
          <StoryRow key={label} label={label} hint={hint}>
            <div className={`w-full ${widthClassName}`}>
              <ProviderRetryBannerView
                cancelling={false}
                onCancel={() => undefined}
                providerName="Claude Code"
                view={view}
              />
            </div>
          </StoryRow>
        ))}
      </StoryCard>
    </main>
  );
}
