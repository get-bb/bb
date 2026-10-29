import type { ReactNode } from "react";
import { DiffStatsTally } from "@bb/shared-ui/diff-stats-tally";
import { Icon } from "@bb/shared-ui/icon";
import { InfoRowTime } from "@bb/shared-ui/info-list-row";
import {
  INFO_SECTION_TITLE_CLASS,
  InfoList,
} from "@/components/secondary-panel/info/info-list";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadContextCardRow } from "./ThreadContextCardRow";

export default {
  title: "Thread context card/Rows",
};

const noop = () => {};
const NOW = Date.now();

function StoryCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-72 shrink-0 rounded-2xl border border-border bg-popover p-2 text-popover-foreground">
      {children}
    </div>
  );
}

function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_288px] items-start gap-x-4">
      <span className="pt-3 text-xs text-muted-foreground">{label}</span>
      <StoryCard>{children}</StoryCard>
    </div>
  );
}

function Gallery({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 p-4">
      <h2 className="text-sm text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="[&:not(:first-child)]:mt-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-2">
      <div className="mb-0.5 flex min-h-5 items-center px-2">
        <h3 className={INFO_SECTION_TITLE_CLASS}>
          <span className="truncate">{title}</span>
        </h3>
      </div>
      {children}
    </section>
  );
}

export function Parent() {
  return (
    <Gallery title="Parent row (bb)">
      <Variant label="child thread">
        <ThreadContextCardRow
          icon="UserRound"
          label="Parent: Plan the release"
          onClick={noop}
        />
      </Variant>
      <Variant label="fork">
        <ThreadContextCardRow
          icon="Fork"
          label="Forked from: Fix flaky checkout tests"
          onClick={noop}
        />
      </Variant>
      <Variant label="long title">
        <ThreadContextCardRow
          icon="UserRound"
          label="Parent: Investigate why the checkout retry metrics double count flaky tests on CI"
          onClick={noop}
        />
      </Variant>
    </Gallery>
  );
}

function ChangesRow({
  insertions,
  deletions,
}: {
  insertions: number;
  deletions: number;
}) {
  return (
    <ThreadContextCardRow
      icon="FileDiff"
      label="Changes"
      trailing={
        <DiffStatsTally insertions={insertions} deletions={deletions} />
      }
      onClick={noop}
    />
  );
}

export function Changes() {
  return (
    <Gallery title="Changes row (Git plugin)">
      <Variant label="small change">
        <ChangesRow insertions={4} deletions={1} />
      </Variant>
      <Variant label="large change">
        <ChangesRow insertions={1284} deletions={310} />
      </Variant>
      <Variant label="only deletions">
        <ChangesRow insertions={0} deletions={48} />
      </Variant>
    </Gallery>
  );
}

type StoryChild = {
  id: string;
  title: string;
  indicator: Parameters<typeof ThreadStatusGlyph>[0]["indicator"];
  minutesAgo: number;
};

const CHILDREN: StoryChild[] = [
  {
    id: "a",
    title: "Add retry metrics to checkout",
    indicator: "none",
    minutesAgo: 300,
  },
  {
    id: "b",
    title: "Write the retry reporter hook",
    indicator: "waiting-for-input",
    minutesAgo: 4,
  },
  {
    id: "c",
    title: "Quarantine the payment confirmation flake",
    indicator: "unread-error",
    minutesAgo: 22,
  },
  {
    id: "d",
    title: "Draft the CI dashboard",
    indicator: "unread-success",
    minutesAgo: 41,
  },
  {
    id: "e",
    title: "Pin the clock in money tests",
    indicator: "none",
    minutesAgo: 90,
  },
  {
    id: "f",
    title: "Group failures by error signature",
    indicator: "none",
    minutesAgo: 1440,
  },
];

function ChildThreads({ items }: { items: StoryChild[] }) {
  return (
    <Section title="Child threads">
      <InfoList
        items={items}
        getKey={(child) => child.id}
        limit={4}
        renderItem={(child) => (
          <li className="list-none">
            <ThreadContextCardRow
              leading={
                child.indicator === "none" ? (
                  <Icon name="ChildThread" aria-hidden />
                ) : (
                  <ThreadStatusGlyph
                    indicator={child.indicator}
                    size="compact"
                  />
                )
              }
              label={child.title}
              trailing={
                <InfoRowTime
                  timestamp={NOW - child.minutesAgo * 60_000}
                  now={NOW}
                />
              }
              onClick={noop}
            />
          </li>
        )}
      />
    </Section>
  );
}

export function ChildThreadsSection() {
  return (
    <Gallery title="Child threads section (bb)">
      <Variant label="one child">
        <ChildThreads items={CHILDREN.slice(0, 1)} />
      </Variant>
      <Variant label="statuses">
        <ChildThreads items={CHILDREN.slice(0, 4)} />
      </Variant>
      <Variant label="more than four">
        <ChildThreads items={CHILDREN} />
      </Variant>
      <Variant label="below rows">
        <ChangesRow insertions={4} deletions={1} />
        <ChildThreads items={CHILDREN.slice(0, 2)} />
      </Variant>
    </Gallery>
  );
}
