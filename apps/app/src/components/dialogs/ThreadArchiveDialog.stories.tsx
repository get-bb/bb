import { ThreadArchiveDialogContent } from "./ThreadArchiveDialog";
import { makeThread } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default { title: "dialogs/Thread Archive" };
const noop = () => {};
const thread = makeThread({
  id: "thr_parent",
  title: "Review release",
  createdAt: 1790881200000,
});

export function Preview() {
  return (
    <StoryCard>
      <StoryRow
        label="Archive preview"
        hint="Component test fixture: linked titles, statuses, creation dates and hidden threads."
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread,
              archiveThreads: [
                thread,
                makeThread({
                  id: "thr_child",
                  title:
                    "Verify a long thread title wraps without hiding the session name",
                  status: "active",
                  createdAt: 1790884800000,
                }),
                makeThread({
                  id: "thr_side",
                  title: "Side chat",
                  status: "idle",
                  createdAt: 1790888400000,
                  visibility: "hidden",
                }),
              ],
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
