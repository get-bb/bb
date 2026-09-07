import { useState } from "react";
import { BranchPicker, type BranchPickerProps } from "./BranchPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Branch Picker",
};

const branches = [
  "main",
  "develop",
  "staging",
  "bb/feat/review-flow",
  "bb/fix/timeline-pagination",
  "bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk",
] as const;

const remoteBranches = [
  "origin/main",
  "origin/develop",
  "origin/release/1.3",
  "origin/bb/feat/review-flow",
  "upstream/main",
] as const;

type BranchPickerStoryConfig = Omit<
  BranchPickerProps,
  "onChange" | "options" | "variant"
> & { branchOptions?: readonly string[] };

interface BranchPickerStoryRowProps {
  label: string;
  hint: string;
  picker: BranchPickerStoryConfig;
  variant?: BranchPickerProps["variant"];
  includeRemoteOptions?: boolean;
}

const branchFromPicker: BranchPickerStoryConfig = {
  value: "main",
  triggerLabel: "Branch from: main",
  triggerTitle: "Branch from: main",
  menuKind: "base",
  modal: false,
};

const mergeBasePicker: BranchPickerStoryConfig = {
  value: "origin/main",
  modal: false,
};

const longBranchPicker: BranchPickerStoryConfig = {
  value: "bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk",
  triggerLabel:
    "bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk",
  triggerTitle:
    "Branch: bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk",
  defaultOpen: true,
  modal: false,
};

function BranchPickerStoryRow({
  label,
  hint,
  picker,
  variant,
  includeRemoteOptions = true,
}: BranchPickerStoryRowProps) {
  const { branchOptions, ...branchPickerProps } = picker;
  const [value, setValue] = useState(picker.value);
  const triggerLabel =
    picker.menuKind === "base" && value !== null
      ? `Branch from: ${value}`
      : picker.triggerLabel;
  const triggerTitle =
    picker.menuKind === "base" && value !== null
      ? `Branch from: ${value}`
      : picker.triggerTitle;

  return (
    <StoryRow label={label} hint={hint}>
      <BranchPicker
        {...branchPickerProps}
        value={value}
        options={branchOptions ?? branches}
        remoteOptions={includeRemoteOptions ? remoteBranches : undefined}
        triggerLabel={triggerLabel}
        triggerTitle={triggerTitle}
        variant={variant}
        onChange={setValue}
      />
    </StoryRow>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="190px">
      <BranchPickerStoryRow
        label="choose merge base"
        hint="pick a comparison branch for an existing worktree"
        picker={mergeBasePicker}
      />
      <BranchPickerStoryRow
        label="minimal branch from"
        hint="minimal trigger for new worktree base"
        picker={branchFromPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="open long branches"
        hint="branch names wrap inside the popover"
        picker={longBranchPicker}
      />
    </StoryCard>
  );
}

export function EmptyStates() {
  return (
    <StoryCard labelWidth="190px">
      <BranchPickerStoryRow
        label="loading branches"
        hint="branch options are still loading"
        includeRemoteOptions={false}
        picker={{
          value: null,
          loading: true,
          branchOptions: [],
          defaultOpen: true,
          modal: false,
          triggerLabel: "Loading branches...",
        }}
      />
      <BranchPickerStoryRow
        label="no branches found"
        hint="the repository has no selectable branches"
        includeRemoteOptions={false}
        picker={{
          value: null,
          branchOptions: [],
          defaultOpen: true,
          modal: false,
          triggerLabel: "Select branch",
        }}
      />
    </StoryCard>
  );
}
