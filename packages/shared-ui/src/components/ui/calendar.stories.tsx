import { useState } from "react";
import { Calendar } from "./calendar.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Calendar",
};

function SingleDateDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 28));
  return <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-md border border-border" />;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Single date selection">
        <SingleDateDemo />
      </StoryRow>
    </StoryCard>
  );
}
