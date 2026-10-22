import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";
import { AppUpdateConfirmDialogContent } from "./AppUpdateConfirmDialog";
import { AppUpdateRestartingOverlay } from "./AppUpdateHost";

export default {
  title: "app-update/Update bb",
};

const noop = () => {};

export function ConfirmDialog() {
  return (
    <StoryCard>
      <StoryRow
        label="Commands running"
        hint="Shown only when threads are running. Update stops them now and resumes each thread after the restart."
      >
        <DialogStage>
          <AppUpdateConfirmDialogContent
            runningThreadCount={3}
            pending={false}
            onCancel={noop}
            onConfirm={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="One command running" hint="Singular copy.">
        <DialogStage>
          <AppUpdateConfirmDialogContent
            runningThreadCount={1}
            pending={false}
            onCancel={noop}
            onConfirm={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function RestartingInterstitial() {
  return (
    <AppUpdateRestartingOverlay
      patienceMs={60 * 60 * 1000}
      targetRevision="0.47.0"
      onDismiss={noop}
    />
  );
}
