import { Alert, AlertDescription, AlertTitle } from "./alert.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Alert",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Destructive, with an inline retry action"
        hint="vburojevic/bb-plugin-handoff:app.tsx — shown when a session's stats fail to load"
      >
        <Alert variant="destructive" className="w-96">
          <AlertTitle>Couldn&apos;t read this session</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            The session log ended unexpectedly at turn 14.
            <Button size="sm" variant="outline">
              <Icon name="RotateCcw" aria-hidden />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </StoryRow>
      <StoryRow label="Default variant, informational">
        <Alert className="w-96">
          <AlertTitle>This checkout is on another machine</AlertTitle>
          <AlertDescription>dev-box-02 — Live is unaffected, it needs no checkout.</AlertDescription>
        </Alert>
      </StoryRow>
    </StoryCard>
  );
}
