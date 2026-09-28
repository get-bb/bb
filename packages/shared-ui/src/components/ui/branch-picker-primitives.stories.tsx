import { useRef, useState } from "react";
import {
  BRANCH_PICKER_CONTENT_CLASS_NAME,
  BranchPickerRow,
  BranchPickerSearch,
  BranchPickerSectionHeader,
} from "./branch-picker-primitives.js";
import { MenuHoverProvider } from "./menu-item-hover.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/BranchPickerPrimitives",
};

const BRANCHES = ["main", "feature/checkout-flow", "fix/retry-logic", "release/1.4"];

function BranchListDemo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("main");
  const filtered = BRANCHES.filter((branch) =>
    branch.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <MenuHoverProvider>
      <div className={`${BRANCH_PICKER_CONTENT_CLASS_NAME} border border-border`}>
        <BranchPickerSearch
          inputRef={inputRef}
          query={query}
          enterSelection={filtered[0]}
          onEnterSelection={setSelected}
          onQueryChange={setQuery}
        />
        <div className="max-h-64 overflow-y-auto px-1 pb-1">
          <BranchPickerSectionHeader label="Branches" />
          {filtered.map((branch) => (
            <BranchPickerRow
              key={branch}
              icon="GitMerge"
              selected={branch === selected}
              title={branch}
              onSelect={() => setSelected(branch)}
            >
              <span className="min-w-0 flex-1 truncate">{branch}</span>
            </BranchPickerRow>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No branches found.</p>
          ) : null}
        </div>
      </div>
    </MenuHoverProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Branch list popover content"
        hint="apps/app/src/components/pickers/BranchPicker.tsx — search + section header + selectable rows"
      >
        <BranchListDemo />
      </StoryRow>
    </StoryCard>
  );
}
