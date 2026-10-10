import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  CompactHomePage,
  HOME_THREADS,
  PhoneFrame,
} from "./mobile-home-story-fixtures";

const LONG_DRAFT = Array.from(
  { length: 30 },
  (_, index) => `${index + 1}. Step ${index + 1} of the repro`,
).join("\n");

export default {
  title: "views/Compact Home",
};

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow
        label="composer pinned, recents scroll behind it"
        hint="393×852 with the real recents list. The composer is an overlay at the bottom; rows run underneath it and dissolve into a strong fade rather than stopping at a hard edge."
      >
        <PhoneFrame>
          <CompactHomePage />
        </PhoneFrame>
      </StoryRow>
      <StoryRow
        label="short list"
        hint="with only a few threads the list still rests above the composer instead of stretching to fill"
      >
        <PhoneFrame>
          <CompactHomePage threads={HOME_THREADS.slice(0, 3)} />
        </PhoneFrame>
      </StoryRow>
      <StoryRow
        label="keyboard open, long draft"
        hint="the keyboard leaves a short region; a tall draft scrolls inside the editor so the composer's top edge stays below the header"
      >
        <PhoneFrame heightClass="h-[480px]">
          <CompactHomePage composerValue={LONG_DRAFT} />
        </PhoneFrame>
      </StoryRow>
    </StoryCard>
  );
}
