import { useState } from "react";
import { Slider } from "./slider.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Slider",
};

function VolumeSliderDemo() {
  const [value, setValue] = useState([60]);
  return (
    <div className="flex w-64 items-center gap-3">
      <Slider value={value} onValueChange={setValue} max={100} step={1} aria-label="Volume" />
      <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">{value[0]}</span>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single-thumb value control">
        <VolumeSliderDemo />
      </StoryRow>
    </StoryCard>
  );
}
