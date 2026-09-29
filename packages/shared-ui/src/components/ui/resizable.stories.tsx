import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Resizable",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Two-pane horizontal split">
        <ResizablePanelGroup direction="horizontal" className="h-40 w-96 rounded-md border border-border">
          <ResizablePanel defaultSize={40}>
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Sidebar
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60}>
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Content
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </StoryRow>
    </StoryCard>
  );
}
