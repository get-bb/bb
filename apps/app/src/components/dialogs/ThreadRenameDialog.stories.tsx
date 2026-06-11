import { useRef } from "react";
import {
  ThreadRenameDialogContent,
  type ThreadRenameDialogTarget,
} from "./ThreadRenameDialog";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Rename",
};

const noop = () => {};

const defaultTarget: ThreadRenameDialogTarget = {
  id: "thr_demo",
  currentTitle: "Audit recurring permission failures",
};

const parentTarget: ThreadRenameDialogTarget = {
  id: "thr_parent",
  currentTitle: "Frontend Parent",
};

const longTitleTarget: ThreadRenameDialogTarget = {
  id: "thr_long",
  currentTitle:
    "Investigate slow tests on recurring CI failures after the timeline pagination v2 merge",
};

export function Overview() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <StoryCard>
      <StoryRow label="default" hint="thread, idle">
        <DialogStage>
          <ThreadRenameDialogContent
            target={defaultTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="parent thread"
        hint="parent threads use the same rename dialog copy"
      >
        <DialogStage>
          <ThreadRenameDialogContent
            target={parentTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="submit in flight — input and submit are disabled"
      >
        <DialogStage>
          <ThreadRenameDialogContent
            target={defaultTarget}
            pending
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="long title"
        hint="input overflows horizontally inside the dialog frame"
      >
        <DialogStage>
          <ThreadRenameDialogContent
            target={longTitleTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="empty input"
        hint="clear the field and submit to see the validation message"
      >
        <DialogStage>
          <ThreadRenameDialogContent
            target={{ id: "thr_blank", currentTitle: "" }}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
