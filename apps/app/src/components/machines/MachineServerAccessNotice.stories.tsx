import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { MachineServerAccessNoticeContent } from "./MachineServerAccessNotice";
import { machineServerAccessBlockedReason } from "./machine-server-access";
import {
  CONNECT_PAIRED,
  CONNECT_UNPAIRED,
} from "../../../.ladle/machine-story-fixtures";

export default {
  title: "settings/Machine server access notice",
};

export function Reasons() {
  return (
    <StoryCard labelWidth="230px" className="max-w-4xl">
      <StoryRow
        label="access is not set up"
        hint="whatever the method's own complaint is, the reader is told the one thing to do"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(CONNECT_UNPAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="access is set up"
        hint="the notice renders nothing at all"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(CONNECT_PAIRED)}
        />
      </StoryRow>
    </StoryCard>
  );
}
