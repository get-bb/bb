import { useRef, type ReactNode } from "react";
import {
  THREAD_RENAME_DIALOG_SHELL_CLASS,
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

const slashTitleTarget: ThreadRenameDialogTarget = {
  id: "thr_folder",
  currentTitle: "test/say hi",
};

const longTitleTarget: ThreadRenameDialogTarget = {
  id: "thr_long",
  currentTitle:
    "Investigate slow tests on recurring CI failures after the timeline pagination v2 merge",
};

function ThreadRenameDialogStage({ children }: { children: ReactNode }) {
  return (
    <DialogStage className={THREAD_RENAME_DIALOG_SHELL_CLASS}>
      {children}
    </DialogStage>
  );
}

export function Overview() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <StoryCard>
      <StoryRow label="default" hint="thread, idle">
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={defaultTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
      <StoryRow
        label="parent thread"
        hint="parent threads use the same rename dialog copy"
      >
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={parentTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
      <StoryRow label="slash title" hint="slashes stay part of the title">
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={slashTitleTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="submit in flight — input and submit are disabled"
      >
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={defaultTarget}
            pending
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
      <StoryRow
        label="long title"
        hint="input overflows horizontally inside the dialog frame"
      >
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={longTitleTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
      <StoryRow
        label="empty input"
        hint="clear the field and submit to see the validation message"
      >
        <ThreadRenameDialogStage>
          <ThreadRenameDialogContent
            target={{ id: "thr_blank", currentTitle: "" }}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </ThreadRenameDialogStage>
      </StoryRow>
    </StoryCard>
  );
}
