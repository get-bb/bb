import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Sheet",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Side panel, right">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              Open sheet
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Panel settings</SheetTitle>
              <SheetDescription>A side-anchored overlay, distinct from Dialog's centered modal.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </StoryRow>
    </StoryCard>
  );
}
