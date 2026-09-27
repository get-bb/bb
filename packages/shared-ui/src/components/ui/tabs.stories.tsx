import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Tabs",
};

function ContentSwitcherDemo() {
  return (
    <Tabs defaultValue="labels" className="w-72">
      <TabsList>
        <TabsTrigger value="labels">Labels</TabsTrigger>
        <TabsTrigger value="presets">Presets</TabsTrigger>
        <TabsTrigger value="folders">Folders</TabsTrigger>
      </TabsList>
      <TabsContent
        value="labels"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage the labels used across tasks.
      </TabsContent>
      <TabsContent
        value="presets"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage agent presets.
      </TabsContent>
      <TabsContent
        value="folders"
        className="pt-3 text-sm text-muted-foreground"
      >
        Manage folders.
      </TabsContent>
    </Tabs>
  );
}

function NavigationDemo() {
  const [view, setView] = useState("issues");
  return (
    <div className="flex w-72 flex-col gap-3">
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="pulls">Pull requests</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        {view === "issues"
          ? "Showing open issues."
          : "Showing open pull requests."}
      </p>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Content switcher"
        hint="plugins/tasks/views/manage/manage-panel.tsx — an uncontrolled Tabs with TabsContent panels, simplified"
      >
        <ContentSwitcherDemo />
      </StoryRow>
      <StoryRow
        label="Navigation control"
        hint="plugins/github/app.tsx — a controlled Tabs used as a segmented nav; the selected view drives content rendered outside Tabs, not TabsContent"
      >
        <NavigationDemo />
      </StoryRow>
    </StoryCard>
  );
}
