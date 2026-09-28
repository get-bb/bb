import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "./menubar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Menubar",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="File menu">
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>
                New Thread <MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem>
                Open Project <MenubarShortcut>⌘O</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem>Close Window</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </StoryRow>
    </StoryCard>
  );
}
