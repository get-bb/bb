import type { PermissionMode } from "@bb/domain";
import { PermissionModePicker } from "./PermissionModePicker";
import type { PickerOption } from "./OptionPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Permission Mode Picker",
};

// Mirrors PERMISSION_MODE_OPTIONS in useThreadCreationOptions.ts
const allOptions: readonly PickerOption<PermissionMode>[] = [
  { value: "full", label: "Full Access", tone: "warning" },
  { value: "workspace-write", label: "Workspace Write" },
  { value: "readonly", label: "Readonly" },
];

const longOptions: readonly PickerOption<PermissionMode>[] = [
  {
    value: "full",
    label: "Full Access with approval before every workspace-changing command",
    description:
      "Use this when the agent needs broad execution capability, but the picker should still wrap the warning copy inside the menu.",
    tone: "warning",
  },
  {
    value: "workspace-write",
    label: "Workspace Write with repository-scoped edits and background tasks",
    description:
      "Allows file edits in the workspace while keeping the menu content wrapped within the picker width.",
  },
  {
    value: "readonly",
    label: "Readonly investigation without filesystem writes",
    description:
      "Long readonly explanations should wrap instead of stretching or clipping the permission menu.",
  },
];

const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="muted by default — used in prompt-box only">
        <PermissionModePicker
          value="workspace-write"
          options={allOptions}
          onChange={noop}
          supported
        />
      </StoryRow>
      <StoryRow label="full access selected" hint='warning tone'>
        <PermissionModePicker
          value="full"
          options={allOptions}
          onChange={noop}
          supported
        />
      </StoryRow>
      <StoryRow
        label="plan mode locked"
        hint="effective Plan Mode display, underlying permission unchanged"
      >
        <PermissionModePicker
          value="full"
          options={allOptions}
          onChange={noop}
          supported
          disabled
          showChevronWhenDisabled
          displayOverride={{
            label: "Plan Mode",
            compactLabel: "Plan",
            description:
              "Claude Code will plan without normal full-access execution.",
          }}
        />
      </StoryRow>
      <StoryRow
        label="non-muted"
        hint="explicit muted={false} — for non-prompt-box use"
      >
        <PermissionModePicker
          value="workspace-write"
          options={allOptions}
          onChange={noop}
          supported
          muted={false}
        />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <PermissionModePicker
          value="workspace-write"
          options={allOptions}
          onChange={noop}
          supported
          defaultOpen
          modal={false}
        />
      </StoryRow>
      <StoryRow label="wrapping menu" hint="long labels and descriptions">
        <PermissionModePicker
          value="workspace-write"
          options={longOptions}
          onChange={noop}
          supported
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
