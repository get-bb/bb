import type { ReactNode } from "react";

import { CustomizeBuild, ProviderChips } from "../landing/landing-visuals";
import type { CompareHighlight } from "./comparisons";
import {
  AgentSplit,
  AnywhereVisual,
  SpawnTimeline,
  TeamCost,
  UsageVisual,
  type BrandLogo,
  UsageVisual,
} from "./compare-visuals";

export type SectionCopy = {
  title: string;
  body: ReactNode;
};

export type CompetitorPlan = {
  plan: string;
  logo: BrandLogo;
  yearlyPerSeatMonthly: number;
  priceNote: string;
};

export const PRICING_COPY: SectionCopy = {
  title: "Run more agents, $0 more",
  body: (
    <>
      <p>
        You only pay for the AI plans you already have. bb is free, whether you
        run one agent or your whole team runs dozens.
      </p>
      <p>It’s MIT-licensed open source.</p>
    </>
  ),
};

export const AGENTS_COPY: SectionCopy = {
  title: "Agents that work together like a team",
  body: (
    <p>
      Claude Code builds, Codex reviews, and Pi writes the release notes. No
      copying between tools.
    </p>
  ),
};

export const SPAWN_COPY: SectionCopy = {
  title: "Let one agent orchestrate the rest",
  body: (
    <p>
      Any agent can start new threads with any provider, hand each one part of
      the job, and message them as they work. When a thread finishes, the agent
      that started it hears back on its own, so one task becomes a multi-agent
      team.
    </p>
  ),
};

export const ANYWHERE_COPY: SectionCopy = {
  title: "Your agents keep working while you’re away",
  body: (
    <>
      <p>
        Put bb on a desktop or server that stays on, and your agents keep going
        after you close your laptop.
      </p>
      <p>Check in from the mobile app or any browser.</p>
    </>
  ),
};

export const LIMITS_COPY: SectionCopy = {
  title: "Don’t lose work to usage limits",
  body: (
    <>
      <p>If an agent hits a usage limit, bb keeps your work moving.</p>
      <p>
        Spread work across the accounts you already have, and schedule it around
        your limits.
      </p>
    </>
  ),
};

export const PLUGINS_COPY: SectionCopy = {
  title: "Turn bb into the tool you need",
  body: (
    <>
      <p>
        bb comes with everything you need: worktrees, diffs, automations, a
        mobile app and more.
      </p>
      <p>
        When you want more—or less—customize in Settings, browse the{" "}
        <a href="/marketplace">plugin marketplace</a>, or ask an agent to build
        exactly what you need.
      </p>
      <p>It’s available wherever you use bb, including your phone.</p>
    </>
  ),
};

export function pricingSection(
  copy: SectionCopy,
  competitor: CompetitorPlan,
): CompareHighlight {
  return {
    title: copy.title,
    wide: false,
    visual: (
      <TeamCost
        plan={competitor.plan}
        logo={competitor.logo}
        yearlyPerSeatMonthly={competitor.yearlyPerSeatMonthly}
        priceNote={competitor.priceNote}
      />
    ),
    body: copy.body,
  };
}

function agentsBody(copy: SectionCopy) {
  return (
    <>
      {copy.body}
      <div className="providers cmp-providers">
        <span className="label">Works with any agent</span>
        <ProviderChips />
      </div>
      <p className="cmp-providers-note">
        Need another? Add it with a <a href="/marketplace">plugin</a>.
      </p>
    </>
  );
}

export function agentsSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: true,
    visual: <AgentSplit />,
    body: agentsBody(copy),
  };
}

export function spawnSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: true,
    visual: <SpawnTimeline />,
    body: copy.body,
  };
}

export function anywhereSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: false,
    visual: <AnywhereVisual />,
    body: copy.body,
  };
}

export function limitsSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: false,
    visual: <UsageVisual />,
    body: copy.body,
  };
}

export function pluginsSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: false,
    visual: <CustomizeBuild />,
    body: copy.body,
  };
}
