import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/RadioGroup",
};

function HostModeDemo() {
  const [mode, setMode] = useState<"all" | "selected">("all");
  const hasHosts = true;

  return (
    <RadioGroup
      className="w-72 gap-1"
      value={mode}
      onValueChange={(value) => {
        if (value === "all" || value === "selected") setMode(value);
      }}
    >
      <label
        htmlFor="keep-awake-all-hosts"
        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
      >
        <RadioGroupItem
          id="keep-awake-all-hosts"
          value="all"
          aria-label="All hosts"
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">All hosts</span>
          <span className="block text-xs text-muted-foreground">
            Include hosts added in the future. Only macOS hosts are
            supported.
          </span>
        </span>
      </label>
      <label
        htmlFor="keep-awake-selected-hosts"
        className={
          hasHosts
            ? "flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
            : "flex cursor-not-allowed items-start gap-3 rounded-md px-2 py-2 opacity-50"
        }
      >
        <RadioGroupItem
          id="keep-awake-selected-hosts"
          value="selected"
          aria-label="Specific hosts"
          disabled={!hasHosts}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">Specific hosts</span>
          <span className="block text-xs text-muted-foreground">
            Choose individual Macs below.
          </span>
        </span>
      </label>
    </RadioGroup>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Mode selector"
        hint="plugins/keep-awake/app.tsx — two-option radio group gating a checklist below it"
      >
        <HostModeDemo />
      </StoryRow>
    </StoryCard>
  );
}
