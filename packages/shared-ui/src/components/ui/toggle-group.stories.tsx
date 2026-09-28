import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ToggleGroup",
};

const REASONING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function ReasoningEffortDemo() {
  const [value, setValue] = useState("medium");
  return (
    <ToggleGroup
      type="single"
      aria-label="Reasoning"
      value={value}
      onValueChange={(next) => {
        if (next) setValue(next);
      }}
      className="flex gap-1"
    >
      {REASONING_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="h-6 rounded-sm px-2 text-xs font-normal shadow-none data-[state=on]:bg-state-active data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Reasoning effort control"
        hint="apps/app/src/components/pickers/ModelReasoningPicker.tsx — single-select segmented control in a picker menu"
      >
        <ReasoningEffortDemo />
      </StoryRow>
    </StoryCard>
  );
}
