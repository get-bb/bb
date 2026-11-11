import { useEffect, type ComponentType } from "react";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk";
import type { IconName } from "@bb/shared-ui/icon";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ThreadContextCard,
  ThreadContextCardProvider,
  type CoreThreadContextCardSection,
} from "./PluginThreadContextCard";
import { ThreadContextCardRow } from "./ThreadContextCardRow";

export default {
  title: "Thread context card/Sections",
};

const noop = () => {};

interface StorySection {
  pluginId: string;
  id: string;
  title: string;
  rows: ReadonlyArray<{ icon: IconName; label: string; trailing?: string }>;
  summary?: string;
}

const SECTIONS: readonly StorySection[] = [
  {
    pluginId: "story-pr-desk",
    id: "pull-requests",
    title: "Pull requests",
    summary: "6 PRs · 1 needs you",
    rows: [
      {
        icon: "GitPullRequest",
        label: "Fold card sections",
        trailing: "CI ok",
      },
      { icon: "GitPullRequest", label: "Clamp long notes", trailing: "review" },
      {
        icon: "GitPullRequest",
        label: "Retire Herd SDK calls",
        trailing: "blocked",
      },
      {
        icon: "GitPullRequest",
        label: "Kit Segment shrink",
        trailing: "CI ok",
      },
      {
        icon: "GitPullRequest",
        label: "Quick Bridge loader",
        trailing: "merged",
      },
      { icon: "GitPullRequest", label: "Wakeup redesign", trailing: "draft" },
    ],
  },
  {
    pluginId: "story-guild",
    id: "seat",
    title: "Guild",
    summary: "builder@redesigns",
    rows: [
      { icon: "Users", label: "builder@redesigns", trailing: "working" },
      { icon: "ListTodo", label: "#311 Fold card sections" },
    ],
  },
  {
    pluginId: "story-wakeup",
    id: "wakeups",
    title: "Wake-ups",
    summary: "2 pending · next in 12m",
    rows: [
      { icon: "Clock", label: "Check CI on the fork", trailing: "12m" },
      { icon: "Clock", label: "Review Sol feedback", trailing: "2h" },
    ],
  },
  {
    pluginId: "story-brain",
    id: "ledger",
    title: "Brain",
    rows: [{ icon: "BookOpen", label: "Code red follow-through" }],
  },
  {
    pluginId: "story-herd",
    id: "delegates",
    title: "Delegates",
    summary: "2 running · 1 done",
    rows: [
      { icon: "Fork", label: "bb-card-fold", trailing: "running" },
      { icon: "Fork", label: "kit-segment", trailing: "running" },
      { icon: "Fork", label: "pr-desk-clamp", trailing: "done" },
    ],
  },
];

function sectionComponent(
  section: StorySection,
): ComponentType<ExperimentalThreadContextCardProps> {
  return function StorySectionBody() {
    return (
      <>
        {section.rows.map((row) => (
          <ThreadContextCardRow
            key={row.label}
            icon={row.icon}
            label={row.label}
            trailing={row.trailing}
            onClick={noop}
          />
        ))}
      </>
    );
  };
}

function summaryComponent(
  text: string,
): ComponentType<ExperimentalThreadContextCardProps> {
  return function StorySectionSummary() {
    return <>{text}</>;
  };
}

function ChildThreadsBody() {
  return (
    <ThreadContextCardRow
      icon="ChildThread"
      label="Write the retry reporter hook"
      onClick={noop}
    />
  );
}

const CORE_SECTIONS: readonly CoreThreadContextCardSection[] = [
  {
    id: "childThreads",
    title: "Child threads",
    group: "1_related",
    order: 10,
    component: ChildThreadsBody,
  },
];

function SectionsFixture({
  openTitles,
  withSummaries,
}: {
  openTitles: readonly string[];
  withSummaries: boolean;
}) {
  useEffect(() => {
    for (const section of SECTIONS) {
      setPluginSlotRegistrations(
        section.pluginId,
        makePluginRegistrationSet({
          threadContextCardSections: [
            {
              id: section.id,
              title: section.title,
              group: "2_plugins",
              component: sectionComponent(section),
              ...(withSummaries && section.summary !== undefined
                ? { summary: summaryComponent(section.summary) }
                : {}),
            },
          ],
        }),
      );
    }
    const frame = requestAnimationFrame(() => {
      for (const title of openTitles) {
        const toggle = document.querySelector<HTMLButtonElement>(
          `section[aria-label="${title}"] button[aria-expanded="false"]`,
        );
        toggle?.click();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const section of SECTIONS) {
        removePluginSlotRegistrations(section.pluginId);
      }
    };
  }, [openTitles, withSummaries]);
  return (
    <div className="p-6">
      <ThreadContextCardProvider
        enabled
        coreRows={[]}
        coreSections={CORE_SECTIONS}
        threadId="thr_story"
        projectId="proj_story"
        environment={null}
      >
        <div data-scroll-overlay="" className="flex w-[1500px] justify-start">
          <ThreadContextCard />
        </div>
      </ThreadContextCardProvider>
    </div>
  );
}

const NO_OPEN: readonly string[] = [];
const ONE_OPEN: readonly string[] = ["Pull requests"];

export function AllClosed() {
  return <SectionsFixture openTitles={NO_OPEN} withSummaries />;
}

export function OneOpen() {
  return <SectionsFixture openTitles={ONE_OPEN} withSummaries />;
}

export function ClosedWithoutSummaries() {
  return <SectionsFixture openTitles={NO_OPEN} withSummaries={false} />;
}
