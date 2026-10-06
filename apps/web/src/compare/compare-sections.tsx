import type { ReactNode } from "react";

import { CustomizeBuild, ProviderChips } from "../landing/landing-visuals";
import type { CompareHighlight } from "./comparisons";
import {
  AgentSplit,
  AnywhereVisual,
  SpawnTimeline,
  TeamCost,
  type BrandLogo,
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
  title: "Run more agents, $0 more.",
  body: (
    <>
      <p>
        You only pay for the AI plans you already have. bb is free, whether you
        run one agent on your own or your whole team runs dozens.
      </p>
      <p>
        The mobile app, automations, remote access, and plugins all come
        included.
      </p>
    </>
  ),
};

export const AGENTS_COPY: SectionCopy = {
  title: "Agents that work together like a team",
  body: (
    <p>
      Claude Code builds, Codex reviews, and Cursor writes the release notes. No
      copying between tools.
    </p>
  ),
};

export const SPAWN_COPY: SectionCopy = {
  title: "Hand off the whole job",
  body: (
    <p>
      Give one agent a big task. It splits the work across Claude Code, Codex,
      Cursor, and others running side by side, and they message each other as
      they go. You come back to finished work, not notes to pass between tools.
    </p>
  ),
};

export const ANYWHERE_COPY: SectionCopy = {
  title: "Keep working from anywhere",
  body: (
    <>
      <p>
        Start tasks and answer your agents from the bb desktop app, the mobile
        app, or any browser.
      </p>
      <p>
        Run agents on your laptop, a desktop at home, or a cloud server, and
        manage them all from one bb. They keep working while you’re out.
      </p>
    </>
  ),
};

export const PLUGINS_COPY: SectionCopy = {
  title: "Turn bb into the tool you need",
  body: (
    <>
      <p>
        bb comes with everything you need out of the box: worktrees, diffs,
        automations, a mobile app and more.
      </p>
      <p>
        When you want more—or less—customize in Settings, browse the{" "}
        <a href="/marketplace">plugin marketplace</a>, or ask an agent to build
        exactly what you need, immediately available wherever you use bb,
        including your phone.
      </p>
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
    body: agentsBody(copy),
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

export function pluginsSection(copy: SectionCopy): CompareHighlight {
  return {
    title: copy.title,
    wide: false,
    visual: <CustomizeBuild />,
    body: copy.body,
  };
}
