import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Drawer",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Bottom drawer">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" size="sm">
              Open drawer
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <div className="p-4">
              <DrawerTitle>Confirm action</DrawerTitle>
              <DrawerDescription>This bottom sheet is the vaul-backed Drawer primitive.</DrawerDescription>
              <DrawerClose asChild>
                <Button variant="outline" size="sm" className="mt-4">
                  Close
                </Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </StoryRow>
    </StoryCard>
  );
}
