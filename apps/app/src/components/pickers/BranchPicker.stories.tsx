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

const noop = () => {};

type BranchPickerStoryConfig = Omit<
  BranchPickerProps,
  "onChange" | "options" | "variant"
>;

interface BranchPickerStoryRowProps {
  label: string;
  hint: string;
  includeRemoteOptions?: boolean;
  picker: BranchPickerStoryConfig;
  variant?: BranchPickerProps["variant"];
}

interface BranchPickerStoryState {
  isCreatingNew: boolean;
  value: string | null;
}

interface GetInitialBranchPickerStoryStateArgs {
  picker: BranchPickerStoryConfig;
}

interface GetCreateBranchBaseArgs {
  currentBranch?: string | null;
  value: string | null;
}

interface GetStoryTriggerLabelArgs {
  picker: BranchPickerStoryConfig;
  state: BranchPickerStoryState;
}

interface GetStoryTriggerTitleArgs {
  picker: BranchPickerStoryConfig;
  state: BranchPickerStoryState;
}

const currentCheckoutPicker: BranchPickerStoryConfig = {
  value: null,
  currentBranch: "main",
  currentOptionLabel: "Current: main",
  currentOptionTitle: "Use the current checkout without switching branches",
  triggerLabel: "Current (main)",
  triggerTitle: "Current: main",
  menuKind: "checkout",
  onClear: noop,
  onCreate: noop,
  modal: false,
};

const branchFromPicker: BranchPickerStoryConfig = {
  value: "main",
  currentBranch: "main",
  triggerLabel: "Branch from: main",
  triggerTitle: "Branch from: main",
  menuKind: "base",
  modal: false,
};

const mergeBasePicker: BranchPickerStoryConfig = {
  value: "origin/main",
  modal: false,
};

const checkoutBranchPicker: BranchPickerStoryConfig = {
  ...currentCheckoutPicker,
  value: "develop",
  triggerLabel: "Checkout: develop",
  triggerTitle: "Checkout: develop",
};

const newBranchPicker: BranchPickerStoryConfig = {
  ...currentCheckoutPicker,
  value: "origin/main",
  isCreatingNew: true,
  triggerLabel: "New branch from: origin/main",
  triggerTitle: "Create a new branch from origin/main",
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

function getInitialBranchPickerStoryState({
  picker,
}: GetInitialBranchPickerStoryStateArgs): BranchPickerStoryState {
  return {
    isCreatingNew: picker.isCreatingNew ?? false,
    value: picker.value,
  };
}

function getCreateBranchBase({
  currentBranch,
  value,
}: GetCreateBranchBaseArgs): string | null {
  return value ?? currentBranch ?? branches[0] ?? null;
}

function getStoryTriggerLabel({
  picker,
  state,
}: GetStoryTriggerLabelArgs): string | undefined {
  if (picker.menuKind === "checkout") {
    if (state.isCreatingNew) {
      return state.value === null
        ? "New branch"
        : `New branch from: ${state.value}`;
    }
    if (state.value !== null) {
      return `Checkout: ${state.value}`;
    }
    return picker.currentBranch
      ? `Current (${picker.currentBranch})`
      : picker.triggerLabel;
  }

  if (picker.menuKind === "base" && state.value !== null) {
    return `Branch from: ${state.value}`;
  }

  return picker.triggerLabel;
}

function getStoryTriggerTitle({
  picker,
  state,
}: GetStoryTriggerTitleArgs): string | undefined {
  if (picker.menuKind === "checkout") {
    if (state.isCreatingNew) {
      return state.value === null
        ? "Create a new branch"
        : `Create a new branch from ${state.value}`;
    }
    if (state.value !== null) {
      return `Checkout: ${state.value}`;
    }
    return picker.currentBranch
      ? `Current: ${picker.currentBranch}`
      : undefined;
  }

  if (picker.menuKind === "base" && state.value !== null) {
    return `Branch from: ${state.value}`;
  }

  return picker.triggerTitle;
}

function BranchPickerStoryRow({
  label,
  hint,
  includeRemoteOptions = true,
  picker,
  variant,
}: BranchPickerStoryRowProps) {
  const [state, setState] = useState(() =>
    getInitialBranchPickerStoryState({ picker }),
  );
  const triggerLabel = getStoryTriggerLabel({ picker, state });
  const triggerTitle = getStoryTriggerTitle({ picker, state });
  const handleCreate = picker.onCreate
    ? () => {
        const branchName = getCreateBranchBase({
          currentBranch: picker.currentBranch,
          value: state.value,
        });

        if (branchName === null) {
          return;
        }

        setState({
          isCreatingNew: true,
          value: branchName,
        });
      }
    : undefined;
  const handleClear = picker.onClear
    ? () => {
        setState({
          isCreatingNew: false,
          value: null,
        });
      }
    : undefined;

  return (
    <StoryRow label={label} hint={hint}>
      <BranchPicker
        {...picker}
        value={state.value}
        isCreatingNew={state.isCreatingNew}
        options={branches}
        remoteOptions={includeRemoteOptions ? remoteBranches : undefined}
        triggerLabel={triggerLabel}
        triggerTitle={triggerTitle}
        variant={variant}
        onChange={(branch) => {
          setState({
            isCreatingNew: false,
            value: branch,
          });
        }}
        onCreateBaseChange={(branch) => {
          setState({
            isCreatingNew: true,
            value: branch,
          });
        }}
        onClear={handleClear}
        onCreate={handleCreate}
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
        label="minimal current"
        hint="current checkout selected"
        includeRemoteOptions={false}
        picker={currentCheckoutPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="minimal new branch"
        hint="new branch selected with a base"
        picker={newBranchPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="minimal checkout"
        hint="checkout selected with an existing branch"
        picker={checkoutBranchPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="minimal branch from"
        hint="minimal trigger for new worktree base"
        picker={branchFromPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="open current"
        hint="defaultOpen + modal=false - top section chooses current, new branch, or checkout"
        picker={{ ...currentCheckoutPicker, defaultOpen: true }}
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
