import { useState } from "react";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import {
  SelectableMessageProse,
  type MessageProseSelection,
} from "./SelectableMessageProse";

export default {
  title: "thread/timeline/SelectableProse",
};

const SAMPLE =
  "Select any run of this agent prose. When both endpoints land inside the wrapped node, onSelect reports the trimmed text and its bounding rect.";

function SelectionReadout({
  selection,
}: {
  selection: MessageProseSelection | null;
}) {
  if (!selection) {
    return (
      <p className="text-xs text-muted-foreground">
        No in-bounds selection (collapsed, empty, or escaped the prose).
      </p>
    );
  }
  return (
    <p className="text-xs text-foreground">
      Selected: <span className="font-medium">&ldquo;{selection.text}&rdquo;</span>{" "}
      <span className="text-muted-foreground">
        ({Math.round(selection.rect.width)}×{Math.round(selection.rect.height)})
      </span>
    </p>
  );
}

export function LiveSelection() {
  const [selection, setSelection] = useState<MessageProseSelection | null>(
    null,
  );
  return (
    <StoryCard>
      <StoryRow
        label="In-bounds selection"
        hint="Drag-select text inside the box; the readout updates"
      >
        <div className="flex flex-col gap-2">
          <SelectableMessageProse
            className="select-text rounded-md border p-3 text-sm leading-relaxed"
            onSelect={setSelection}
          >
            {SAMPLE}
          </SelectableMessageProse>
          <SelectionReadout selection={selection} />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function GuardedEscapingSelection() {
  const [selection, setSelection] = useState<MessageProseSelection | null>(
    null,
  );
  return (
    <StoryCard>
      <StoryRow
        label="Selection escaping prose"
        hint="Select across the boundary into the text below the wrapper — it reports null"
      >
        <div className="flex flex-col gap-2">
          <SelectableMessageProse
            className="select-text rounded-md border p-3 text-sm leading-relaxed"
            onSelect={setSelection}
          >
            {SAMPLE}
          </SelectableMessageProse>
          <p className="select-text rounded-md bg-surface-recessed p-3 text-sm text-muted-foreground">
            This paragraph sits OUTSIDE the selectable prose. A selection that
            starts inside the box and ends here is rejected.
          </p>
          <SelectionReadout selection={selection} />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
