import { Button } from "@bb/shared-ui/button";
import { DetailCard, DetailRow } from "./detail-card";
import { Input } from "@bb/shared-ui/input";
import { BranchPicker } from "../pickers/BranchPicker";
import { OptionPicker } from "../pickers/OptionPicker";
import {
  WorkspaceChangesList,
  type WorkspaceChangedFile,
} from "../thread/WorkspaceChangesList";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { Icon } from "@bb/shared-ui/icon";

export default {
  title: "ui/Detail Card",
};

const noop = () => {};

const mockModelOptions = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "gpt-5-5", label: "GPT-5.5" },
] as const;

const mockMergeBaseOptions = ["origin/main", "origin/develop"] as const;

const mockChangedFiles: WorkspaceChangedFile[] = [
  {
    path: "apps/app/src/components/ui/detail-card.tsx",
    status: "M",
    insertions: 18,
    deletions: 4,
  },
  {
    path: "apps/app/src/components/HireManagerModal.tsx",
    status: "M",
    insertions: 7,
    deletions: 3,
  },
  {
    path: "apps/app/src/components/thread/dialogs/ThreadGitActionDialog.tsx",
    status: "A",
    insertions: 56,
    deletions: 0,
  },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="transparent">
        <DetailCard className="w-full max-w-xl rounded-none border-0 bg-transparent px-0 py-0">
          <DetailRow label="Manager" valueClassName="min-w-0">
            <div className="inline-flex max-w-full min-w-0 items-center gap-1 text-xs text-foreground">
              <a
                href="#manager"
                className="min-w-0 truncate text-xs text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2"
              >
                Frontend Parent
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
                aria-label="Unassign manager"
                onClick={noop}
              >
                <Icon name="X" />
              </Button>
            </div>
          </DetailRow>
          <DetailRow label="Environment" valueClassName="min-w-0 truncate">
            Direct
          </DetailRow>
          <DetailRow label="Branch" valueClassName="min-w-0 truncate">
            <button
              type="button"
              className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-foreground transition-colors hover:text-foreground/80"
              onClick={noop}
              aria-label="Copy branch name"
              title="Copy branch name"
            >
              <span className="truncate">
                bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk
              </span>
              <Icon
                name="Copy"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </button>
          </DetailRow>
          <DetailRow label="Merge base" valueClassName="min-w-0 truncate">
            <BranchPicker
              value="origin/main"
              options={mockMergeBaseOptions}
              variant="minimal"
              onChange={noop}
              className="max-w-full"
            />
          </DetailRow>
          <DetailRow label="Git status" align="start" valueClassName="min-w-0">
            <div
              className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
              title="Modified 3 files, 1 staged"
            >
              <span className="shrink-0 font-medium text-foreground">
                Modified
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                3 files, 1 staged
              </span>
            </div>
          </DetailRow>
          <DetailRow label="Changed files" orientation="vertical">
            <WorkspaceChangesList files={mockChangedFiles} />
          </DetailRow>
        </DetailCard>
      </StoryRow>
      <StoryRow label="bordered">
        <DetailCard
          className="w-full max-w-xl border-border bg-surface-recessed"
          labelWidth="60px"
        >
          <DetailRow label="Name" valueClassName="min-w-0">
            <Input
              placeholder="Eg. Manager (optional)"
              className="border-border text-sm"
              defaultValue="Frontend Parent"
            />
          </DetailRow>
          <DetailRow label="Model" valueClassName="min-w-0">
            <OptionPicker
              label="Model"
              value="claude-sonnet-4-6"
              options={mockModelOptions}
              onChange={noop}
            />
          </DetailRow>
        </DetailCard>
      </StoryRow>
    </StoryCard>
  );
}
