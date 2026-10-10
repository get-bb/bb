import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { InlineConfirmation } from "@bb/shared-ui/inline-confirmation";
import {
  SuggestionCard,
  SuggestionGroup,
  SuggestionSection,
  SuggestionTile,
} from "@bb/shared-ui/suggestion-card";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "promptbox/Suggestion Card",
};

interface FirstTask {
  icon: string;
  title: string;
  description: string;
  plugin: string | null;
}

const FIRST_TASKS: readonly FirstTask[] = [
  {
    icon: "Explore",
    title: "Walk me through acme-web",
    description: "Read-only. How it starts and where things live.",
    plugin: null,
  },
  {
    icon: "Workflow",
    title: "Research 3 competitors of acme-web",
    description: "Three agents, one product each, one summary.",
    plugin: null,
  },
  {
    icon: "Browser",
    title: "Test a page of my app in a browser",
    description: "Clicks through like a new user and reports what broke.",
    plugin: "Browser Automation",
  },
  {
    icon: "Bug",
    title: "Fix the newest bug in acme-web",
    description: "Fixes it on a branch and shows you the diff.",
    plugin: null,
  },
];

function FirstTaskCards({
  initialPicked = null,
  compact = false,
}: {
  initialPicked?: number | null;
  compact?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(initialPicked);
  return (
    <SuggestionSection
      label={compact ? "First task" : "Pick a first task for acme-web"}
    >
      <div className={compact ? "grid gap-2" : "grid grid-cols-2 gap-3"}>
        {FIRST_TASKS.map((task, index) => (
          <SuggestionCard
            key={task.title}
            leading={
              <SuggestionTile>
                <Icon aria-hidden name={task.icon} className="size-4" />
              </SuggestionTile>
            }
            title={task.title}
            description={task.description}
            compact={compact}
            selected={picked === index}
            onSelect={() => setPicked(index)}
            meta={
              task.plugin === null ? undefined : picked === index ? (
                <InlineConfirmation>{task.plugin} turned on</InlineConfirmation>
              ) : (
                `Turns on ${task.plugin}`
              )
            }
          />
        ))}
      </div>
    </SuggestionSection>
  );
}

function AttentionTile({ icon }: { icon: string }) {
  return (
    <span className="relative">
      <SuggestionTile>
        <Icon aria-hidden name={icon} className="size-4" />
      </SuggestionTile>
      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-attention ring-2 ring-card" />
    </span>
  );
}

function Stage({
  width = "w-[720px]",
  children,
}: {
  width?: string;
  children: ReactNode;
}) {
  return <div className={width}>{children}</div>;
}

export function Overview() {
  return (
    <StoryCard labelWidth="190px">
      <StoryRow
        label="first tasks"
        hint="Under the home composer until the first thread. Picking a card fills the composer and never sends."
      >
        <Stage>
          <FirstTaskCards />
        </Stage>
      </StoryRow>
      <StoryRow
        label="first task picked"
        hint="A card that needs a plugin turns it on and confirms inside the card. No Undo; the plugin can be turned off in Plugins."
      >
        <Stage>
          <FirstTaskCards initialPicked={2} />
        </Stage>
      </StoryRow>
      <StoryRow
        label="phone"
        hint="One column, title only; the plugin line stays because it names a side effect."
      >
        <Stage width="w-[366px]">
          <FirstTaskCards compact initialPicked={2} />
        </Stage>
      </StoryRow>
      <StoryRow
        label="threads that need you"
        hint="Same card; the attention dot plus the words in the meta line mark urgency, never color alone."
      >
        <Stage>
          <SuggestionSection label="Threads that need you">
            <div className="grid gap-3">
              <SuggestionCard
                leading={<AttentionTile icon="MessageSquare" />}
                title="Add rate limiting to the checkout API"
                description="Asked: keep the old /v1 endpoint working, or remove it?"
                meta="Needs your answer · Codex · 4m ago"
                trailing={
                  <Icon aria-hidden name="ChevronRight" className="size-3.5" />
                }
              />
              <SuggestionCard
                leading={<AttentionTile icon="MessageSquare" />}
                title="Migrate the cart to the new pricing model"
                description="Waiting for approval to run the database migration."
                meta="Needs approval · Claude Code · 12m ago"
                trailing={
                  <Icon aria-hidden name="ChevronRight" className="size-3.5" />
                }
              />
            </div>
          </SuggestionSection>
        </Stage>
      </StoryRow>
      <StoryRow
        label="tips"
        hint="Tips keep one grouped container with the same rows, so they stay quieter than first tasks and threads that need you."
      >
        <Stage>
          <SuggestionSection label="Tips">
            <SuggestionGroup>
              <SuggestionCard
                grouped
                leading={
                  <SuggestionTile>
                    <Icon aria-hidden name="Columns2" className="size-4" />
                  </SuggestionTile>
                }
                title="Open waiting threads side by side"
                description="Ask bb to put each thread that's waiting on you in its own split pane."
              />
              <SuggestionCard
                grouped
                leading={
                  <SuggestionTile>
                    <Icon aria-hidden name="Clock" className="size-4" />
                  </SuggestionTile>
                }
                title="Run this every morning"
                description="Turn a thread into an automation that runs on a schedule."
              />
            </SuggestionGroup>
          </SuggestionSection>
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
