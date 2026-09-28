import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/AlertDialog",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Archive confirmation"
        hint="vburojevic/bb-plugin-linear:app/ArchiveDialog.tsx — reversible action, so the body says so explicitly"
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              Archive ENG-42
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive ENG-42?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>Fix the retry backoff on the sync worker</strong>
                <br />
                <br />
                This archives the issue in Linear, for everyone — not just in bb. It is{" "}
                <strong>reversible</strong> in Linear&apos;s own UI, and it is not a delete.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90">
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </StoryRow>
    </StoryCard>
  );
}
