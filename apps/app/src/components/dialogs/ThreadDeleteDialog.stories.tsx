import { ThreadDeleteDialogContent } from "./ThreadDeleteDialog";
import { makeThread } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Delete",
};

const noop = () => {};

const standardThread = makeThread();
const parentThread = makeThread({
  id: "thr_parent",
  title: "Frontend Parent",
  titleFallback: "Frontend Parent",
});

export function Thread() {
  return (
    <StoryCard>
      <StoryRow
        label="clean workspace"
        hint="basic confirm — no warnings, just 'cannot be undone'"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="delete request in flight">
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Parent() {
  return (
    <StoryCard>
      <StoryRow
        label="no children, clean workspace"
        hint="same minimal confirm as a thread"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: parentThread }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="child threads"
        hint="N child threads require delete confirmation"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: parentThread,
              childThreadCount: 3,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="single child"
        hint="same confirmation language with one child"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: parentThread,
              childThreadCount: 1,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
